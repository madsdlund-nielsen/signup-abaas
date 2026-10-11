import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdapters } from "@/lib";
import { NotConfiguredError, ProviderError } from "@/lib/errors";
import { createOpsMetricsProvider } from "@/lib/ops-metrics";
import { exceptionTypeName, summarizeExceptionTypes } from "@/lib/ops-metrics/posthog";
import { getPostHogOps } from "@/server/admin";

/**
 * PostHog-læseadapteren til /admin/drift (ADR 0066) mod en mocket `fetch` — ingen netværk.
 * Dækker factory-valg (rigtig/demo/stub), request-form, auth, timeout, fejl og at
 * serverlaget aldrig kaster.
 */
const KEY = "phx_test_læsenøgle";
const realEnv = { FLAG_ANALYTICS: "true", POSTHOG_PERSONAL_API_KEY: KEY, POSTHOG_PROJECT_ID: "12345" };
const query = { since: new Date("2026-10-10T12:00:00Z"), activeSince: new Date("2026-10-04T12:00:00Z") };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Svar efter hvilken forespørgsel der stilles: totaler-rækken eller fejltype-rækkerne. */
function okFetch(types: unknown[][] = [], totals: unknown[][] = [[100, 4, 7]]) {
  const fn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const sql = JSON.parse(String(init?.body)).query.query as string;
    return json({ results: sql.includes("GROUP BY") ? types : totals });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("adapter-valg", () => {
  it("flag + læsenøgle + projekt-id vælger PostHog", () => {
    expect(createOpsMetricsProvider(realEnv).name).toBe("posthog");
    expect(getAdapters(realEnv).opsMetrics.name).toBe("posthog");
  });

  it("uden flag, nøgle eller projekt-id: stub", () => {
    expect(createOpsMetricsProvider({}).name).toBe("stub");
    expect(createOpsMetricsProvider({ ...realEnv, FLAG_ANALYTICS: undefined }).name).toBe("stub");
    expect(createOpsMetricsProvider({ ...realEnv, POSTHOG_PERSONAL_API_KEY: "  " }).name).toBe("stub");
    expect(createOpsMetricsProvider({ ...realEnv, POSTHOG_PROJECT_ID: undefined }).name).toBe("stub");
  });

  it("ingest-nøglen POSTHOG_KEY er ikke en læsenøgle", () => {
    expect(createOpsMetricsProvider({ FLAG_ANALYTICS: "true", POSTHOG_KEY: "phc_x", POSTHOG_HOST: "https://eu.i.posthog.com" }).name).toBe("stub");
  });

  it("demo vælges kun når læsenøglen mangler — rigtig config vinder altid (ADR 0041)", () => {
    expect(createOpsMetricsProvider({ FLAG_DEMO: "true" }).name).toBe("demo");
    expect(createOpsMetricsProvider({ ...realEnv, FLAG_DEMO: "true" }).name).toBe("posthog");
  });

  it("stubben kaster NotConfiguredError — aldrig nuller", async () => {
    await expect(createOpsMetricsProvider({}).getOpsMetrics(query)).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("demoen returnerer åbenlyst falske, mærkede tal", async () => {
    const m = await createOpsMetricsProvider({ FLAG_DEMO: "true" }).getOpsMetrics(query);
    expect(m).toEqual({
      events: 1,
      exceptions: 1,
      topExceptionTypes: [{ type: "[DEMO] DemoFejl", count: 1 }],
      activePeople: 1,
    });
  });
});

describe("PostHogOpsMetricsProvider", () => {
  it("POST'er HogQL til projektets query-endpoint med Bearer-nøgle", async () => {
    const fetchMock = okFetch();
    await createOpsMetricsProvider(realEnv).getOpsMetrics(query);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://eu.posthog.com/api/projects/12345/query/");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body as string);
    expect(body.query.kind).toBe("HogQLQuery");
    expect(body.query.query).toContain("FROM events");
    expect(body.query.query).toContain("2026-10-10 12:00:00");
    expect(body.query.query).toContain("2026-10-04 12:00:00");
  });

  it("henter aldrig fejlbeskeder eller person-felter (kun type og antal)", async () => {
    const fetchMock = okFetch();
    await createOpsMetricsProvider(realEnv).getOpsMetrics(query);
    const sqls = fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).query.query as string);
    for (const sql of sqls) {
      expect(sql).not.toMatch(/\$exception_values|\$exception_message|email|\$ip/i);
    }
  });

  it("respekterer POSTHOG_API_HOST (uden afsluttende skråstreg)", async () => {
    const fetchMock = okFetch();
    await createOpsMetricsProvider({ ...realEnv, POSTHOG_API_HOST: "https://ph.example.test/" }).getOpsMetrics(query);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://ph.example.test/api/projects/12345/query/");
  });

  it("mapper totaler og top-3 fejltyper", async () => {
    okFetch(
      [
        ['["TypeError"]', null, 5],
        [null, "RangeError", 2],
        ['["TypeError"]', null, 1],
        ['["Error"]', null, 3],
        ['["Zed"]', null, 1],
      ],
      [[100, 12, 7]],
    );
    const m = await createOpsMetricsProvider(realEnv).getOpsMetrics(query);
    expect(m.events).toBe(100);
    expect(m.exceptions).toBe(12);
    expect(m.activePeople).toBe(7);
    expect(m.topExceptionTypes).toEqual([
      { type: "TypeError", count: 6 },
      { type: "Error", count: 3 },
      { type: "RangeError", count: 2 },
    ]);
  });

  it("en tom projektperiode giver ægte nuller fra PostHog, ikke en fejl", async () => {
    okFetch([], [[0, 0, 0]]);
    const m = await createOpsMetricsProvider(realEnv).getOpsMetrics(query);
    expect(m).toEqual({ events: 0, exceptions: 0, topExceptionTypes: [], activePeople: 0 });
  });

  it.each([
    [401, /ugyldig/, false],
    [403, /Query Read/, false],
    [404, /projekt-id/, false],
    [429, /budget|rate limit/, true],
    [500, /intern fejl/, true],
  ])("HTTP %i giver en dansk ProviderError", async (status, text, retryable) => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "hemmelig svartekst", attr: "x" }, status)));
    const error = await createOpsMetricsProvider(realEnv).getOpsMetrics(query).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    const e = error as ProviderError;
    expect(e.status).toBe(status);
    expect(e.retryable).toBe(retryable);
    expect(e.message).toMatch(text);
    expect(e.message).not.toContain("hemmelig svartekst");
    expect(e.message).not.toContain(KEY);
  });

  it("timeout og netværksfejl bliver forbigående ProviderErrors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" }))));
    const t = (await createOpsMetricsProvider(realEnv).getOpsMetrics(query).catch((e: unknown) => e)) as ProviderError;
    expect(t.message).toMatch(/tidsfristen på 8 sekunder/);
    expect(t.retryable).toBe(true);

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    const n = (await createOpsMetricsProvider(realEnv).getOpsMetrics(query).catch((e: unknown) => e)) as ProviderError;
    expect(n.message).toMatch(/netværksfejl/);
  });

  it("afviser uventede svarformer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ results: "nej" })));
    await expect(createOpsMetricsProvider(realEnv).getOpsMetrics(query)).rejects.toThrow(/uventet format/);
    vi.stubGlobal("fetch", vi.fn(async () => json({ results: [["ikke et tal", 1, 1]] })));
    await expect(createOpsMetricsProvider(realEnv).getOpsMetrics(query)).rejects.toThrow(/uventet format/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    await expect(createOpsMetricsProvider(realEnv).getOpsMetrics(query)).rejects.toThrow(/gyldig JSON/);
  });

  it("sender aldrig nøglen over http (undtagen localhost) og kræver numerisk projekt-id", async () => {
    const fetchMock = okFetch();
    await expect(
      createOpsMetricsProvider({ ...realEnv, POSTHOG_API_HOST: "http://ph.example.test" }).getOpsMetrics(query),
    ).rejects.toThrow(/https/);
    await expect(
      createOpsMetricsProvider({ ...realEnv, POSTHOG_PROJECT_ID: "12/../x" }).getOpsMetrics(query),
    ).rejects.toThrow(/tal/);
    expect(fetchMock).not.toHaveBeenCalled();
    await createOpsMetricsProvider({ ...realEnv, POSTHOG_API_HOST: "http://localhost:9999" }).getOpsMetrics(query);
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("fejltypenavne", () => {
  it("udtrækker kun et rent typenavn", () => {
    expect(exceptionTypeName('["TypeError","Error"]')).toBe("TypeError");
    expect(exceptionTypeName(["RangeError"])).toBe("RangeError");
    expect(exceptionTypeName("Error")).toBe("Error");
  });

  it("alt der ligner en besked, URL eller persondata bliver til 'Ukendt fejltype'", () => {
    expect(exceptionTypeName("Kunne ikke finde mette@example.com")).toBe("Ukendt fejltype");
    expect(exceptionTypeName('["https://x.test/a?token=1"]')).toBe("Ukendt fejltype");
    expect(exceptionTypeName(null)).toBe("Ukendt fejltype");
    expect(exceptionTypeName("[kaput")).toBe("Ukendt fejltype");
    expect(exceptionTypeName(`["${"A".repeat(200)}"]`)).toBe("Ukendt fejltype");
  });

  it("summarize samler efter typenavn og begrænser til tre", () => {
    const out = summarizeExceptionTypes([["A", null, 1], ["B", null, 2], ["C", null, 3], ["D", null, 4]]);
    expect(out.map((o) => o.type)).toEqual(["D", "C", "B"]);
  });
});

describe("getPostHogOps (serverlaget)", () => {
  const now = new Date("2026-10-11T12:00:00Z");

  it("ok/real med rigtige tal", async () => {
    okFetch();
    const r = await getPostHogOps(realEnv, now);
    expect(r).toMatchObject({ state: "ok", source: "real", generatedAt: now.toISOString() });
  });

  it("vinduerne er 24 timer og 7 dage", async () => {
    const fetchMock = okFetch();
    await getPostHogOps(realEnv, now);
    const sql = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).query.query as string;
    expect(sql).toContain("2026-10-10 12:00:00");
    expect(sql).toContain("2026-10-04 12:00:00");
  });

  it("demo → ok/demo; uden config → not_configured", async () => {
    expect(await getPostHogOps({ FLAG_DEMO: "true" }, now)).toMatchObject({ state: "ok", source: "demo" });
    expect(await getPostHogOps({}, now)).toEqual({ state: "not_configured" });
  });

  it("en fejl hos PostHog vælter aldrig kalderen — unreadable, og svarindhold logges ikke", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "hemmelig svartekst" }, 500)));
    expect(await getPostHogOps(realEnv, now)).toEqual({ state: "unreadable" });
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toContain("hemmelig svartekst");
    expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY);
  });
});
