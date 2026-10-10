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
      stub.upsertSubscription({
        membershipId: "m-1",
        customerRef: "c-1",
        subscriptionRef: null,
        amountMinor: 1,
        currency: "DKK",
        intervalDays: 28,
        startsOn: "2026-10-01",
      }),
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

  interface UpdateCall {
    table: string;
    values: Record<string, unknown>;
    filters: Array<[string, string, unknown]>;
  }

  /** Minimal Supabase-dobbelt med kaldsspor. `updateError` fremtvinger en fejlet mutation. */
  function fakeService(updateError: string | null) {
    const calls: string[] = [];
    const updates: UpdateCall[] = [];
    const result = updateError ? { data: null, error: { message: updateError } } : { data: [{ id: "m1" }], error: null };
    return {
      calls,
      updates,
      service: {
        from(table: string) {
          return {
            insert: async () => {
              calls.push(`insert:${table}`);
              return { error: null };
            },
            update: (values: Record<string, unknown>) => {
              const call: UpdateCall = { table, values, filters: [] };
              // Både `await update().eq()` og `await update().eq().is()/.select()` skal virke.
              const chain = {
                eq: (column: string, value: unknown) => (call.filters.push(["eq", column, value]), chain),
                is: (column: string, value: unknown) => (call.filters.push(["is", column, value]), chain),
                select: () => chain,
                then: (resolve: (r: typeof result) => unknown, reject: (e: unknown) => unknown) => {
                  calls.push(`update:${table}`);
                  updates.push(call);
                  return Promise.resolve(result).then(resolve, reject);
                },
              };
              return chain;
            },
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

  function signed(event: string, data: Record<string, unknown>) {
    const body = JSON.stringify({ event, team_uuid: "team-1", timestamp: "2026-08-26T10:00:00Z", data });
    return { body, signature: createHmac("sha256", "s3cret").update(body).digest("hex") };
  }

  function signedCancel() {
    return signed("subscription.cancelled", { customer: { uuid: "cus-1" } });
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

  it("vellykket opsigelse sætter status OG opsigelsesdatoen (kun hvis den er tom) — idempotensrækken står", async () => {
    configure();
    const { service, calls, updates } = fakeService(null);
    mocked.service = service;

    const { body, signature } = signedCancel();
    expect((await post(body, signature)).status).toBe(200);
    expect(calls).toEqual(["insert:payment_webhook_event", "update:membership", "update:membership"]);
    expect(updates[0]?.values).toMatchObject({ status: "opsagt" });
    expect(updates[1]?.values.cancelled_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Datoen flyttes aldrig af en genleveret subscription.ended: kun rækker uden dato rammes.
    expect(updates[1]?.filters).toContainEqual(["is", "cancelled_at", null]);
  });

  it("checkout.completed kobler kunde + abonnement og sætter periodeankeret ÉN gang (ADR 0056)", async () => {
    configure();
    const { service, updates } = fakeService(null);
    mocked.service = service;

    const { body, signature } = signed("checkout.completed", {
      type: "subscription",
      external_customer_id: "membership-1",
      customer: { uuid: "cus-1" },
      subscription: { uuid: "sub-1" },
    });
    expect((await post(body, signature)).status).toBe(200);

    expect(updates[0]?.values).toMatchObject({
      provider_customer_ref: "cus-1",
      provider_subscription_ref: "sub-1",
      card_status: "registreret",
    });
    expect(updates[1]?.values.billing_anchor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Ankeret skrives kun mens det er tomt — en genlevering må ikke forskyde alle fremtidige perioder.
    expect(updates[1]?.filters).toContainEqual(["is", "billing_anchor", null]);
  });

  it("checkout.completed uden abonnements-uuid kobler kun kunden (synkroniseringen fejler så højlydt)", async () => {
    configure();
    const { service, updates } = fakeService(null);
    mocked.service = service;

    const { body, signature } = signed("checkout.completed", {
      type: "subscription",
      external_customer_id: "membership-1",
      customer: { uuid: "cus-1" },
    });
    expect((await post(body, signature)).status).toBe(200);
    expect(updates[0]?.values).not.toHaveProperty("provider_subscription_ref");
  });
});

describe("Alunta-adapteren mod en falsk fetch (ADR 0056)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const request = {
    membershipId: "membership-1",
    customerRef: "cus-1",
    subscriptionRef: "sub-1",
    amountMinor: 1234,
    currency: "DKK",
    intervalDays: 28,
    startsOn: "2026-10-01",
  };

  function provider() {
    return createPaymentProvider({ FLAG_PAYMENTS: "true", ALUNTA_API_KEY: "nøgle", ALUNTA_PLAN_ID: "plan-1" });
  }

  it("upsertSubscription sætter prisen med PUT /subscriptions/{uuid}/price og Bearer-nøgle", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { uuid: "sub-1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider().upsertSubscription(request)).resolves.toEqual({ id: "sub-1" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.alunta.com/api/v1/subscriptions/sub-1/price");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer nøgle");
    expect(JSON.parse(init.body as string)).toEqual({ price: 1234 });
  });

  it("NEGATIV: uden koblet abonnement kaldes Alunta slet ikke — fejler højlydt", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().upsertSubscription({ ...request, subscriptionRef: null })).rejects.toThrow(
      /ikke koblet/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("NEGATIV: en afvist prisændring (422) kaster AluntaError med status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"message":"only flat-rate"}', { status: 422 })),
    );
    await expect(provider().upsertSubscription(request)).rejects.toThrow(/HTTP 422/);
  });

  it("registerCard poster en subscription-checkout og returnerer hosted URL", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { uuid: "cs-1", url: "https://pay.example/cs-1" } }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().registerCard({ customerRef: "membership-1" })).resolves.toEqual({
      id: "cs-1",
      url: "https://pay.example/cs-1",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.alunta.com/api/v1/checkout-sessions");
    expect(init.method).toBe("POST");
  });
});

describe("betalings-webhook: fejlet faktura sender «fejlet betaling» til ejeren (B-41, ADR 0057)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("hvert træk der skifter til 'fejlet' får sin notifikation — efter svaret, uden at påvirke det", async () => {
    vi.stubEnv("ALUNTA_WEBHOOK_SECRET", "s3cret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");

    const notified: string[] = [];
    const afterCallbacks: Array<() => Promise<void>> = [];
    vi.resetModules();
    vi.doMock("next/server", () => ({
      after: (callback: () => Promise<void>) => afterCallbacks.push(callback),
    }));
    vi.doMock("@/server/notifications/meetings", () => ({
      notifyPaymentFailed: async (_service: unknown, chargeId: string) => {
        notified.push(chargeId);
        if (chargeId === "c2") throw new Error("leverandør nede");
        return [];
      },
    }));
    vi.doMock("@/server/auth/supabase-server", () => ({
      createServiceSupabase: () => ({
        from(table: string) {
          const chain = {
            select: () => chain,
            eq: () => chain,
            insert: async () => ({ error: null }),
            update: () => chain,
            maybeSingle: async () => ({ data: { id: "m1" }, error: null }),
            then: (resolve: (r: unknown) => unknown) =>
              Promise.resolve(
                table === "payment_charge"
                  ? { data: [{ id: "c1" }, { id: "c2" }], error: null }
                  : { data: null, error: null },
              ).then(resolve),
          };
          return chain;
        },
      }),
      createServerSupabase: async () => null,
    }));
    const { POST: post } = await import("@/app/api/webhooks/alunta/route");

    const body = JSON.stringify({
      event: "invoice.payment_failed",
      team_uuid: "team-1",
      timestamp: "2026-10-10T10:00:00Z",
      data: { customer: { uuid: "cus-1" }, invoice: { uuid: "inv-1" } },
    });
    const signature = createHmac("sha256", "s3cret").update(body).digest("hex");
    const response = await post(
      new Request("http://localhost/api/webhooks/alunta", { method: "POST", body, headers: { Signature: signature } }),
    );

    expect(response.status).toBe(200);
    expect(notified).toEqual([]); // intet sendes før svaret
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const callback of afterCallbacks) await callback();
    expect(notified).toEqual(["c1", "c2"]); // c2's fejl stopper ikke resten
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).not.toContain("cus-1");
    errors.mockRestore();

    vi.doUnmock("next/server");
    vi.doUnmock("@/server/notifications/meetings");
    vi.doUnmock("@/server/auth/supabase-server");
  });
});
