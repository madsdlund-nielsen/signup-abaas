import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Readiness, VerdictBadge, envNamesLabel } from "@/components/Readiness";
import { getIntegrationOverview } from "@/server/admin/integrations";
import { buildReadiness, type ReadinessInput, type RuleInputs } from "@/server/admin/readiness";
import { LAUNCH_DATA, type LaunchData } from "@/server/admin/launch-env";
import { NOTIFICATION_TYPES } from "@/server/notifications/catalog";
import type { TemplateVersion } from "@/server/notifications/template-state";

/**
 * Go-live-tjeklisten (ADR 0069): den rene aggregator og dens præsentation. Aggregatoren får
 * integrationsstatus, miljø og regler som argumenter, så alt kan afgøres uden database.
 */

const NOW = new Date("2026-10-12T10:00:00Z");

/** Et miljø hvor hver port er rigtig og alle hemmeligheder er sat. */
const FULL_ENV: Record<string, string> = {
  FLAG_BOOKING: "true",
  FLAG_PAYMENTS: "true",
  FLAG_AIFOLLOWUP: "true",
  FLAG_TRANSCRIPTION: "true",
  FLAG_EMAIL: "true",
  FLAG_SMS: "true",
  CALCOM_API_KEY: "a",
  CALCOM_TEAM_ID: "1",
  CALCOM_WEBHOOK_SECRET: "a",
  ALUNTA_API_KEY: "a",
  ALUNTA_PLAN_ID: "a",
  ALUNTA_WEBHOOK_SECRET: "a",
  ORDBOGEN_API_KEY: "a",
  RESEND_API_KEY: "a",
  RESEND_FROM_ADDRESS: "a@b.dk",
  INMOBILE_API_KEY: "a",
  INMOBILE_SENDER: "ABU",
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "a",
  SUPABASE_SERVICE_ROLE_KEY: "a",
  NEXT_PUBLIC_APP_URL: "https://x.dk",
  CRON_SECRET: "a",
  RATING_LINK_SECRET: "z".repeat(40),
};

function template(typeKey: string, channel: "email" | "sms", status: TemplateVersion["status"], version = 1): TemplateVersion {
  return {
    id: `${typeKey}-${channel}-${version}`,
    typeKey,
    channel,
    version,
    status,
    subject: null,
    body: "x",
    publishedAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  };
}

const ALL_LIVE: TemplateVersion[] = NOTIFICATION_TYPES.flatMap((type) =>
  type.channels.map((channel) => template(type.key, channel, "live", 3)),
);

const RULES_OK: RuleInputs = {
  pricing: [{ version: 2, isActive: true }, { version: 1, isActive: false }],
  fee: [{ version: 1, effectiveFrom: "2026-01-01T00:00:00Z" }],
  templates: ALL_LIVE,
};

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  const env = overrides.env ?? FULL_ENV;
  return { integrations: getIntegrationOverview(env), env, rules: RULES_OK, now: NOW, ...overrides };
}

/** Datafilen uden åbne beslutninger og med de tre uudviklede porte accepteret. */
const CLEAN_DATA: LaunchData = {
  ...LAUNCH_DATA,
  porte: LAUNCH_DATA.porte.map((port) =>
    port.realAdapterBuilt ? port : { ...port, accepted: { by: "Andreas", date: "2026-10-12" } },
  ),
  beslutninger: [],
};

describe("buildReadiness", () => {
  it("er klar når alt er rigtigt, sat, aktivt og ingen beslutning er åben", () => {
    const report = buildReadiness(input({ data: CLEAN_DATA }));
    expect(report.summary.blockers).toEqual({
      demo: 0,
      ports: 0,
      secrets: 0,
      flags: 0,
      rules: 0,
      gate: 0,
      decisions: 0,
    });
    expect(report.summary.ready).toBe(true);
  });

  it("blokerer på en stub uden accept, og siger hvorfor", () => {
    const report = buildReadiness(input({ env: {}, integrations: getIntegrationOverview({}) }));
    const booking = report.ports.find((p) => p.key === "booking");
    expect(booking?.verdict).toBe("blokerer");
    expect(booking?.reason).toContain("FLAG_BOOKING");
    const video = report.ports.find((p) => p.key === "video");
    expect(video?.reason).toContain("ingen rigtig adapter");
    expect(report.summary.ready).toBe(false);
  });

  it("tæller FLAG_DEMO som blokering og demo-porte som blokerende", () => {
    const env = { ...FULL_ENV, FLAG_DEMO: "true", FLAG_VIDEO: "true" };
    const report = buildReadiness(input({ env, integrations: getIntegrationOverview(env), data: CLEAN_DATA }));
    expect(report.demo).toEqual({ on: true, verdict: "blokerer" });
    expect(report.summary.blockers.demo).toBe(1);
  });

  it("kræver en accepteret stubs nøgler ikke, men kræver dem ellers", () => {
    const env = { ...FULL_ENV };
    delete env.CALCOM_TEAM_ID;
    const missing = buildReadiness(input({ env, integrations: getIntegrationOverview(env), data: CLEAN_DATA }));
    expect(missing.secrets.find((s) => s.label === "Cal.com team-id")?.verdict).toBe("blokerer");

    const stubOnly = buildReadiness(input({ env: {}, integrations: getIntegrationOverview({}), data: CLEAN_DATA }));
    const accountingKey = stubOnly.secrets.find((s) => s.group === "Bogføring");
    expect(accountingKey).toMatchObject({ required: false, verdict: "klar" });
  });

  it("melder hemmeligheder som sat, mangler eller for kort — uden værdier", () => {
    const env = { ...FULL_ENV, RATING_LINK_SECRET: "kort", CRON_SECRET: "" };
    const report = buildReadiness(input({ env, integrations: getIntegrationOverview(env), data: CLEAN_DATA }));
    const states = Object.fromEntries(report.secrets.filter((s) => s.group === "Platform").map((s) => [s.envNames[0], s.state]));
    expect(states.RATING_LINK_SECRET).toBe("for-kort");
    expect(states.CRON_SECRET).toBe("mangler");
    expect(states.SUPABASE_SERVICE_ROLE_KEY).toBe("sat");
    const json = JSON.stringify(report);
    expect(json).not.toContain("zzzz");
    expect(json).not.toContain("https://x.supabase.co");
  });

  it("aflæser reglerne: aktiv prisregel, gældende honorarregel og live skabeloner pr. type og kanal", () => {
    const report = buildReadiness(input({ data: CLEAN_DATA }));
    expect(report.rules?.pricing).toMatchObject({ activeVersion: 2, versions: 2, verdict: "klar" });
    expect(report.rules?.fee).toMatchObject({ activeVersion: 1, verdict: "klar" });
    const total = NOTIFICATION_TYPES.reduce((sum, type) => sum + type.channels.length, 0);
    expect(report.rules?.templates).toMatchObject({ liveCount: total, totalCount: total, verdict: "klar" });
  });

  it("blokerer uden prisregel, uden gældende honorarregel og med manglende skabeloner", () => {
    const rules: RuleInputs = {
      pricing: [{ version: 1, isActive: false }],
      // Gælder først i fremtiden: ingen regel gælder i dag.
      fee: [{ version: 1, effectiveFrom: "2027-01-01T00:00:00Z" }],
      templates: [template("meeting-changed", "email", "live"), template("meeting-reminder", "email", "udkast")],
    };
    const report = buildReadiness(input({ rules, data: CLEAN_DATA }));
    expect(report.rules?.pricing).toMatchObject({ activeVersion: null, verdict: "blokerer" });
    expect(report.rules?.fee).toMatchObject({ activeVersion: null, verdict: "blokerer" });
    expect(report.rules?.templates.verdict).toBe("blokerer");
    expect(report.rules?.templates.liveCount).toBe(1);
    expect(report.summary.blockers.rules).toBe(3);
  });

  it("tæller en regelsektion der ikke kunne læses som blokering — ukendt er ikke klar", () => {
    const report = buildReadiness(input({ rules: null, data: CLEAN_DATA }));
    expect(report.rules).toBeNull();
    expect(report.summary.blockers.rules).toBe(1);
    expect(report.summary.ready).toBe(false);
  });

  it("deler beslutningerne i åbne og parkerede", () => {
    const data: LaunchData = {
      ...CLEAN_DATA,
      beslutninger: [
        { id: "a", owner: "ejer", blocksLaunch: true, title: "Åben", consequence: "", source: "", parked: null },
        { id: "b", owner: "mads", blocksLaunch: false, title: "Parkeret", consequence: "", source: "", parked: { by: "Andreas", date: "2026-10-12" } },
      ],
    };
    const report = buildReadiness(input({ data }));
    expect(report.decisions.open.map((d) => d.id)).toEqual(["a"]);
    expect(report.decisions.parked.map((d) => d.id)).toEqual(["b"]);
    expect(report.summary.blockers.decisions).toBe(1);
  });

  it("flager et øvrigt flag der afviger fra det dokumenterede", () => {
    const env = { ...FULL_ENV, FLAG_LEADPARTNER: "true" };
    const report = buildReadiness(input({ env, integrations: getIntegrationOverview(env), data: CLEAN_DATA }));
    expect(report.flags.find((f) => f.flag === "leadPartner")).toMatchObject({ enabled: true, verdict: "blokerer" });
    // inAppMessaging er hårdkodet slukket uanset miljø.
    const inApp = buildReadiness(input({ env: { ...FULL_ENV, FLAG_INAPPMESSAGING: "true" }, data: CLEAN_DATA }));
    expect(inApp.flags.find((f) => f.flag === "inAppMessaging")).toMatchObject({ enabled: false, verdict: "klar" });
  });

  it("flager en delvist konfigureret adgangsport", () => {
    const env = { ...FULL_ENV, APP_GATE_ENABLED: "true" };
    const report = buildReadiness(input({ env, integrations: getIntegrationOverview(env), data: CLEAN_DATA }));
    expect(report.gate).toMatchObject({ active: false, partial: true, verdict: "blokerer" });
  });

  it("fejler højlydt for en port der ikke står i datafilen", () => {
    const data: LaunchData = { ...CLEAN_DATA, porte: CLEAN_DATA.porte.filter((p) => p.key !== "sms") };
    const report = buildReadiness(input({ data }));
    expect(report.ports.find((p) => p.key === "sms")).toMatchObject({ verdict: "blokerer" });
  });
});

describe("Readiness (præsentation)", () => {
  it("viser mærker som tekst og tallene først", () => {
    const report = buildReadiness(input({ env: {}, integrations: getIntegrationOverview({}) }));
    const { container } = render(<Readiness report={report} />);
    expect(screen.getAllByText("Blokerer").length).toBeGreaterThan(0);
    expect(screen.getByText("Blokeringer i alt")).toBeTruthy();
    expect(screen.getByText(String(report.summary.totalBlockers))).toBeTruthy();
    expect(container.textContent).toContain("Kun tilstedeværelse vises");
  });

  it("viser en tydelig besked når reglerne ikke kunne læses", () => {
    const report = buildReadiness(input({ rules: null }));
    render(<Readiness report={report} />);
    expect(screen.getByText(/Reglerne kunne ikke læses/)).toBeTruthy();
  });

  it("viser åbne og parkerede beslutninger", () => {
    const data: LaunchData = {
      ...CLEAN_DATA,
      beslutninger: [
        { id: "a", owner: "ejer", blocksLaunch: true, title: "Vilkår", consequence: "Skal foreligge", source: "x", parked: null },
        { id: "b", owner: "mads", blocksLaunch: false, title: "Region", consequence: "", source: "", parked: { by: "Andreas", date: "2026-10-12" } },
      ],
    };
    render(<Readiness report={buildReadiness(input({ data }))} />);
    expect(screen.getByText("Vilkår")).toBeTruthy();
    expect(screen.getByText("Bevidst parkeret")).toBeTruthy();
    expect(screen.getByText("Andreas")).toBeTruthy();
  });

  it("bruger kun token-klasser — ingen inline-styles", () => {
    const report = buildReadiness(input({ env: {}, integrations: getIntegrationOverview({}) }));
    const { container } = render(<Readiness report={report} />);
    expect(container.querySelectorAll("[style]").length).toBe(0);
  });

  it("VerdictBadge: klar er live-tonen, blokerer er blocked-tonen", () => {
    const { container, rerender } = render(<VerdictBadge verdict="klar" />);
    expect(container.querySelector(".status-badge--live")?.textContent).toBe("Klar");
    rerender(<VerdictBadge verdict="blokerer" />);
    expect(container.querySelector(".status-badge--blocked")?.textContent).toBe("Blokerer");
  });

  it("envNamesLabel skriver alternativer med «eller»", () => {
    expect(envNamesLabel(["A", "B"])).toBe("A eller B");
  });
});
