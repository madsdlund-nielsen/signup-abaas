import { describe, expect, it } from "vitest";
import { getAdapters } from "@/lib";
import { getIntegrationOverview, listIntegrations } from "@/server/admin";
import { getOpsOverview } from "@/server/admin/ops";

/**
 * Integrationsstatus (fase 5.4, ADR 0053): driftsskærmen spørger adapter-factoryerne om deres
 * tilstand i stedet for selv at læse nøgler. Disse tests holder skærmen ærlig over for factoryerne.
 */
describe("integrationsstatus gennem portene", () => {
  it("dækker alle ni porte i src/lib", () => {
    expect(listIntegrations({}).map((i) => i.key)).toEqual([
      "booking",
      "video",
      "payments",
      "accounting",
      "llm",
      "transcription",
      "email",
      "sms",
      "analytics",
    ]);
  });

  it("er stub overalt uden flag og nøgler — og flaget er slukket", () => {
    const overview = getIntegrationOverview({});
    expect(overview.integrations.every((i) => i.mode === "stub")).toBe(true);
    expect(overview.integrations.every((i) => !i.flagEnabled)).toBe(true);
    expect(overview.counts).toEqual({ real: 0, demo: 0, stub: 9 });
    expect(overview.demoMode).toBe(false);
  });

  it("følger adapterens eget navn — aldrig sin egen mening om nøgler", () => {
    const env = { FLAG_DEMO: "true", FLAG_EMAIL: "true" };
    const adapters = getAdapters(env);
    for (const item of listIntegrations(env)) {
      expect(item.adapter, item.key).toBe(adapters[item.key as keyof typeof adapters].name);
    }
  });

  it("FLAG_DEMO giver demo for backend-portene og for e-mail/SMS (ADR 0057), men ikke for analytics", () => {
    const byKey = Object.fromEntries(
      listIntegrations({ FLAG_DEMO: "true" }).map((i) => [i.key, i.mode]),
    );
    for (const key of ["booking", "video", "payments", "accounting", "llm", "transcription", "email", "sms"]) {
      expect(byKey[key], key).toBe("demo");
    }
    expect(byKey.analytics).toBe("stub");
    expect(getIntegrationOverview({ FLAG_DEMO: "true" }).demoMode).toBe(true);
  });

  it("rigtige nøgler vinder over demo", () => {
    const env = {
      FLAG_DEMO: "true",
      FLAG_PAYMENTS: "true",
      ALUNTA_API_KEY: "k",
      ALUNTA_PLAN_ID: "p",
    };
    const payments = listIntegrations(env).find((i) => i.key === "payments");
    expect(payments).toMatchObject({ mode: "real", adapter: "alunta", flagEnabled: true });
  });

  it("flaget alene gør ingenting: tændt flag uden nøgler er stadig en stub", () => {
    const booking = listIntegrations({ FLAG_BOOKING: "true" }).find((i) => i.key === "booking");
    expect(booking).toMatchObject({ mode: "stub", flagEnabled: true, flagEnv: "FLAG_BOOKING" });
  });

  it("AI-opfølgning læses fra flaget aiFollowup", () => {
    const llm = listIntegrations({ FLAG_AIFOLLOWUP: "true" }).find((i) => i.key === "llm");
    expect(llm).toMatchObject({ flag: "aiFollowup", flagEnv: "FLAG_AIFOLLOWUP", flagEnabled: true });
  });
});

describe("driftstal uden Supabase-konfiguration", () => {
  it("getOpsOverview returnerer null i stedet for at kaste (kontofri CI/dev)", async () => {
    await expect(getOpsOverview({})).resolves.toBeNull();
  });
});
