import { afterEach, describe, expect, it, vi } from "vitest";

import { NotConfiguredError, ProviderError } from "@/lib/errors";
import { createPostHogEraser, createProcessorErasers, createResendEraser } from "@/lib/erasure";

/**
 * Adaptere til sletning hos eksterne behandlere (ADR 0068): factory-valget (rigtig / demo / stub),
 * og de to rigtige adapteres kald mod en mocket `fetch`. Kun hvor API'et er dokumenteret er der en rigtig
 * implementering — PostHog (persons delete) og Resend (contacts delete). Intet netværk.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "eva.ejer@example.invalid";
const PERSON_ID = "22222222-2222-4222-8222-222222222222";

const posthogEnv = {
  FLAG_ANALYTICS: "true",
  POSTHOG_PERSONAL_API_KEY: "phx_test",
  POSTHOG_PROJECT_ID: "123",
  POSTHOG_API_HOST: "https://eu.posthog.com/",
};

afterEach(() => vi.unstubAllGlobals());

function mockFetch(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("uventet kald");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("factory-valget", () => {
  it("uden flag/nøgler er begge stubs, og de kaster NotConfiguredError (aldrig en stille 'slettet')", async () => {
    const erasers = createProcessorErasers({});
    expect(erasers.map((e) => [e.processor, e.name])).toEqual([
      ["posthog", "stub"],
      ["resend", "stub"],
    ]);
    for (const eraser of erasers) {
      await expect(eraser.eraseDataSubject({ userId: USER_ID, email: EMAIL })).rejects.toBeInstanceOf(NotConfiguredError);
    }
  });

  it("flag uden nøgler (eller nøgler uden flag) giver stadig en stub", () => {
    expect(createPostHogEraser({ FLAG_ANALYTICS: "true" }).name).toBe("stub");
    expect(createPostHogEraser({ POSTHOG_PERSONAL_API_KEY: "x", POSTHOG_PROJECT_ID: "1" }).name).toBe("stub");
    expect(createResendEraser({ FLAG_EMAIL: "true" }).name).toBe("stub");
    expect(createResendEraser({ RESEND_API_KEY: "re_x" }).name).toBe("stub");
  });

  it("rigtig config vælger den rigtige adapter", () => {
    expect(createPostHogEraser(posthogEnv).name).toBe("posthog");
    expect(createResendEraser({ FLAG_EMAIL: "true", RESEND_API_KEY: "re_x" }).name).toBe("resend");
  });

  it("demo vælges kun når rigtig config mangler — og kvitterer DEMO-ERASE-…", async () => {
    const demo = createProcessorErasers({ FLAG_DEMO: "true" });
    expect(demo.map((e) => e.name)).toEqual(["demo", "demo"]);
    const receipt = await demo[0]!.eraseDataSubject({ userId: USER_ID, email: EMAIL });
    expect(receipt.status).toBe("slettet");
    expect(receipt.reference).toMatch(/^DEMO-ERASE-[0-9A-F]{8}$/);
  });

  it("SIKKERHEDSREGEL: rigtige nøgler vinder altid over demo", () => {
    expect(createPostHogEraser({ ...posthogEnv, FLAG_DEMO: "true" }).name).toBe("posthog");
    expect(createResendEraser({ FLAG_EMAIL: "true", RESEND_API_KEY: "re_x", FLAG_DEMO: "true" }).name).toBe("resend");
    // Nøgler uden flag: demo skygger ikke for en delvist konfigureret integration.
    expect(createResendEraser({ RESEND_API_KEY: "re_x", FLAG_DEMO: "true" }).name).toBe("stub");
  });
});

describe("PostHog — slå personen op via distinct-id, slet så person + hændelser + optagelser", () => {
  it("lookup via HogQL og DELETE med delete_events og delete_recordings", async () => {
    const fetchMock = mockFetch(json({ results: [[PERSON_ID]] }), new Response(null, { status: 204 }));
    const receipt = await createPostHogEraser(posthogEnv).eraseDataSubject({ userId: USER_ID, email: EMAIL });
    expect(receipt).toEqual({ status: "slettet", reference: null });

    const [lookupUrl, lookupInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(lookupUrl).toBe("https://eu.posthog.com/api/projects/123/query/");
    expect(lookupInit.method).toBe("POST");
    expect((lookupInit.headers as Record<string, string>).Authorization).toBe("Bearer phx_test");
    const body = JSON.parse(String(lookupInit.body)) as { query: { kind: string; query: string } };
    expect(body.query.kind).toBe("HogQLQuery");
    expect(body.query.query).toContain(`distinct_id = '${USER_ID}'`);
    // Adressen sendes aldrig til PostHog — kun det pseudonyme bruger-id.
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(EMAIL);

    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(deleteUrl).toBe(`https://eu.posthog.com/api/projects/123/persons/${PERSON_ID}/?delete_events=true&delete_recordings=true`);
    expect(deleteInit.method).toBe("DELETE");
  });

  it("ingen person med det distinct-id → intet at slette (idempotent), og der slettes ikke noget", async () => {
    const fetchMock = mockFetch(json({ results: [] }));
    expect(await createPostHogEraser(posthogEnv).eraseDataSubject({ userId: USER_ID, email: EMAIL })).toEqual({
      status: "intet_at_slette",
      reference: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("404 på sletningen (allerede væk) er stadig et vellykket udfald", async () => {
    mockFetch(json({ results: [[PERSON_ID]] }), new Response(null, { status: 404 }));
    const receipt = await createPostHogEraser(posthogEnv).eraseDataSubject({ userId: USER_ID, email: EMAIL });
    expect(receipt.status).toBe("slettet");
  });

  it("NEGATIV: et bruger-id der ikke er en UUID afvises FØR det kommer i forespørgslen (ingen injektion)", async () => {
    const fetchMock = mockFetch();
    await expect(
      createPostHogEraser(posthogEnv).eraseDataSubject({ userId: "x' OR 1=1 --", email: EMAIL }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fejl bærer kun operation og status, og 5xx er genforsøgbar mens 403 ikke er", async () => {
    mockFetch(json({ detail: `person ${EMAIL}` }, 403));
    const forbidden = await createPostHogEraser(posthogEnv)
      .eraseDataSubject({ userId: USER_ID, email: EMAIL })
      .catch((e: unknown) => e as ProviderError);
    expect(forbidden).toMatchObject({ status: 403, retryable: false });
    expect(String((forbidden as Error).message)).not.toContain(EMAIL);

    mockFetch(json({ results: [[PERSON_ID]] }), new Response("fejl", { status: 502 }));
    await expect(createPostHogEraser(posthogEnv).eraseDataSubject({ userId: USER_ID, email: EMAIL })).rejects.toMatchObject({
      status: 502,
      retryable: true,
    });

    mockFetch(new Error("netværk"));
    await expect(createPostHogEraser(posthogEnv).eraseDataSubject({ userId: USER_ID, email: EMAIL })).rejects.toMatchObject({
      status: null,
      retryable: true,
    });
  });

  it("NEGATIV: en ikke-https host afvises (nøglen sendes ikke i klartekst)", async () => {
    const fetchMock = mockFetch();
    const eraser = createPostHogEraser({ ...posthogEnv, POSTHOG_API_HOST: "http://posthog.example.invalid" });
    await expect(eraser.eraseDataSubject({ userId: USER_ID, email: EMAIL })).rejects.toBeInstanceOf(ProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Resend — slet kontakten på e-mailadressen", () => {
  const env = { FLAG_EMAIL: "true", RESEND_API_KEY: "re_test" };

  it("DELETE /contacts/{e-mail} med Bearer-nøglen", async () => {
    const fetchMock = mockFetch(json({ object: "contact", contact: "c1", deleted: true }));
    const receipt = await createResendEraser(env).eraseDataSubject({ userId: USER_ID, email: EMAIL });
    expect(receipt).toEqual({ status: "slettet", reference: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.resend.com/contacts/${encodeURIComponent(EMAIL)}`);
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
  });

  it("404 (ingen kontakt) → intet at slette — de fleste findes ikke, vi opretter ikke kontakter", async () => {
    mockFetch(json({ message: "not found" }, 404));
    expect((await createResendEraser(env).eraseDataSubject({ userId: USER_ID, email: EMAIL })).status).toBe("intet_at_slette");
  });

  it("andre fejl er ProviderError uden adresse i teksten", async () => {
    mockFetch(json({ message: `Contact ${EMAIL} blocked` }, 401));
    const error = await createResendEraser(env)
      .eraseDataSubject({ userId: USER_ID, email: EMAIL })
      .catch((e: unknown) => e as ProviderError);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ status: 401, retryable: false });
    expect((error as Error).message).not.toContain(EMAIL);
  });
});
