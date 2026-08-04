import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaymentProvider } from "@/lib/payments";
import { NotConfiguredError } from "@/lib/errors";
import { listMyCharges } from "@/server/charges";
import { getMyMembership, getMyQuizFrequency } from "@/server/memberships";
import { getActivePricingRule, listPricingRules } from "@/server/pricing";
import { POST } from "@/app/api/webhooks/alunta/route";

describe("payments-stub efter Alunta-omdøbningen (ADR 0029)", () => {
  it("kaster NotConfiguredError med vendor 'alunta'", async () => {
    const stub = createPaymentProvider({});
    await expect(stub.registerCard({ customerRef: "m-1" })).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(
      stub.charge({ customerRef: "m-1", amountMinor: 1, currency: "DKK", frequencyWeeks: 4, description: "x" }),
    ).rejects.toThrow(/alunta/);
  });

  it("stub forbliver aktiv selv med flag+nøgle — adapteren er dataflow-leverancen", async () => {
    const provider = createPaymentProvider({ FLAG_PAYMENTS: "true", ALUNTA_API_KEY: "nøgle" });
    await expect(provider.registerCard({ customerRef: "m-1" })).rejects.toBeInstanceOf(
      NotConfiguredError,
    );
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

describe("alunta-webhook-endpointet — verifikation før alt andet (ADR 0027-mønstret)", () => {
  afterEach(() => vi.unstubAllEnvs());

  function post(body: string, signature?: string): Promise<Response> {
    return POST(
      new Request("http://localhost/api/webhooks/alunta", {
        method: "POST",
        body,
        headers: signature ? { "x-alunta-signature": signature } : {},
      }),
    );
  }

  it("NEGATIV: uden ALUNTA_WEBHOOK_SECRET behandles intet (503, aldrig fail-open)", async () => {
    vi.stubEnv("ALUNTA_WEBHOOK_SECRET", "");
    expect((await post("{}")).status).toBe(503);
  });

  it("NEGATIV: ugyldig/manglende signatur → 401", async () => {
    vi.stubEnv("ALUNTA_WEBHOOK_SECRET", "s3cret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    const body = JSON.stringify({ eventId: "evt-1", type: "charge.gennemfoert" });
    expect((await post(body, "forkert")).status).toBe(401);
    expect((await post(body)).status).toBe(401);
  });

  it("verificeret men ukendt event-form kvitteres 200 uden behandling", async () => {
    vi.stubEnv("ALUNTA_WEBHOOK_SECRET", "s3cret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    const body = JSON.stringify({ eventId: "evt-1", type: "ukendt.type" });
    const response = await post(body, createHmac("sha256", "s3cret").update(body).digest("hex"));
    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/Ignoreret/);
  });
});
