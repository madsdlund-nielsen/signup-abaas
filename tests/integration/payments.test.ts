import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaymentProvider } from "@/lib/payments";
import { NotConfiguredError } from "@/lib/errors";
import { listMyCharges } from "@/server/charges";
import { getMyMembership, getMyQuizFrequency } from "@/server/memberships";
import { getActivePricingRule, listPricingRules } from "@/server/pricing";
import { POST } from "@/app/api/webhooks/alunta/route";

// Supabase mockes KUN for at kunne fremtvinge en fejlende mutation i webhook-handleren.
// De øvrige tests når aldrig så langt (de afvises på secret/signatur/form først).
const mocked = vi.hoisted(() => ({ service: null as unknown }));
vi.mock("@/server/auth/supabase-server", () => ({
  createServiceSupabase: () => mocked.service,
  createServerSupabase: async () => mocked.service,
}));

describe("payments-registry (ADR 0032): adapter ved flag+nøgler, ellers stub", () => {
  it("uden konfiguration: stub der kaster NotConfiguredError med vendor 'alunta'", async () => {
    const stub = createPaymentProvider({});
    expect(stub.name).toBe("stub");
    await expect(stub.registerCard({ customerRef: "m-1" })).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(
      stub.reportUsageCharge({ customerRef: "c-1", amountMinor: 1, idempotencyKey: "k", description: "x" }),
    ).rejects.toThrow(/alunta/);
  });

  it("flag + api-nøgle uden ALUNTA_PLAN_ID er stadig stub (planen er påkrævet)", () => {
    expect(createPaymentProvider({ FLAG_PAYMENTS: "true", ALUNTA_API_KEY: "nøgle" }).name).toBe("stub");
  });

  it("flag + nøgle + plan vælger den rigtige Alunta-adapter", () => {
    const provider = createPaymentProvider({
      FLAG_PAYMENTS: "true",
      ALUNTA_API_KEY: "nøgle",
      ALUNTA_PLAN_ID: "plan-1",
    });
    expect(provider.name).toBe("alunta");
  });
});

describe("betalings-data-access uden Supabase-konfiguration (kontofri CI/dev)", () => {
  it("degraderer til tom/null frem for at kaste", async () => {
    await expect(getActivePricingRule({})).resolves.toBeNull();
    await expect(listPricingRules({})).resolves.toEqual([]);
    await expect(getMyMembership({})).resolves.toBeNull();
    await expect(getMyQuizFrequency({})).resolves.toBeNull();
    await expect(listMyCharges({})).resolves.toEqual([]);
  });
});

function post(body: string, signature?: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/webhooks/alunta", {
      method: "POST",
      body,
      headers: signature ? { Signature: signature } : {},
    }),
  );
}

describe("alunta-webhook-endpointet — Signature-header, verifikation før alt (ADR 0027/0032)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("NEGATIV: uden ALUNTA_WEBHOOK_SECRET behandles intet (503, aldrig fail-open)", async () => {
    vi.stubEnv("ALUNTA_WEBHOOK_SECRET", "");
    expect((await post("{}")).status).toBe(503);
  });

  it("NEGATIV: ugyldig/manglende signatur → 401", async () => {
    vi.stubEnv("ALUNTA_WEBHOOK_SECRET", "s3cret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    const body = JSON.stringify({ event: "invoice.paid", team_id: 1, timestamp: "2026-08-04T10:00:00Z" });
    expect((await post(body, "forkert")).status).toBe(401);
    expect((await post(body)).status).toBe(401);
  });

  it("verificeret men ukendt event-form kvitteres 200 uden behandling", async () => {
    vi.stubEnv("ALUNTA_WEBHOOK_SECRET", "s3cret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    const body = JSON.stringify({ event: "ukendt.type", team_id: 1, timestamp: "2026-08-04T10:00:00Z", data: {} });
    const response = await post(body, createHmac("sha256", "s3cret").update(body).digest("hex"));
    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/Ignoreret/);
  });
});


describe("betalings-webhook: idempotens skal betyde 'præcis én gang' (ADR 0029)", () => {
  afterEach(() => vi.unstubAllEnvs());

  /** Minimal Supabase-dobbelt med kaldsspor. `updateError` fremtvinger en fejlet mutation. */
  function fakeService(updateError: string | null) {
    const calls: string[] = [];
    const result = updateError ? { data: null, error: { message: updateError } } : { data: [{ id: "m1" }], error: null };
    return {
      calls,
      service: {
        from(table: string) {
          return {
            insert: async () => {
              calls.push(`insert:${table}`);
              return { error: null };
            },
            update: () => ({
              eq: async () => {
                calls.push(`update:${table}`);
                return result;
              },
            }),
            delete: () => ({
              eq: () => ({
                eq: async () => {
                  calls.push(`delete:${table}`);
                  return { error: null };
                },
              }),
            }),
          };
        },
      },
    };
  }

  function signedCancel() {
    const body = JSON.stringify({
      event: "subscription.cancelled",
      team_id: 1,
      timestamp: "2026-08-26T10:00:00Z",
      data: { customer: { uuid: "cus-1" } },
    });
    return { body, signature: createHmac("sha256", "s3cret").update(body).digest("hex") };
  }

  function configure() {
    vi.stubEnv("ALUNTA_WEBHOOK_SECRET", "s3cret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  }

  it("fejlet mutation ruller idempotensrækken tilbage, så Aluntas genlevering kan anvende eventet", async () => {
    configure();
    const { service, calls } = fakeService("db nede");
    mocked.service = service;

    const { body, signature } = signedCancel();
    expect((await post(body, signature)).status).toBe(500);
    // Uden rollbacken ville genleveringen ramme 23505 og kvittere 200 uden at anvende noget —
    // en tabt subscription.cancelled ville lade os fakturere en opsagt aftale videre.
    expect(calls).toEqual(["insert:payment_webhook_event", "update:membership", "delete:payment_webhook_event"]);
  });

  it("vellykket mutation lader idempotensrækken stå (ingen rollback)", async () => {
    configure();
    const { service, calls } = fakeService(null);
    mocked.service = service;

    const { body, signature } = signedCancel();
    expect((await post(body, signature)).status).toBe(200);
    expect(calls).toEqual(["insert:payment_webhook_event", "update:membership"]);
  });
});
