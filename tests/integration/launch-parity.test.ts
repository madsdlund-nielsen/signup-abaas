import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { evaluateEnv } from "../../scripts/lib/launch-core.mjs";
import { getIntegrationOverview, listIntegrations } from "@/server/admin";
import { buildReadiness } from "@/server/admin/readiness";
import { LAUNCH_DATA, checkPortKeys, openDecisions } from "@/server/admin/launch-env";

/**
 * Paritet mellem go-live-tjeklistens tre læsere (ADR 0069):
 *   - /admin/klar spørger adapter-factorierne (`getIntegrationOverview`),
 *   - `npm run launch:check` udleder det samme af flag + nøgler (`scripts/lib/launch-core.mjs`),
 *   - begge hviler på datafilen `launch-data.json`.
 * Hvis en factory begynder at læse en anden nøgle, eller en rigtig adapter bygges, skal datafilen
 * følge med — og disse tests fejler indtil den gør.
 */

const root = join(__dirname, "..", "..");

const ALL_KEYS = [
  ...LAUNCH_DATA.generelleHemmeligheder,
  ...LAUNCH_DATA.porte.flatMap((port) => [...port.factoryKeys, ...port.otherKeys]),
].flatMap((key) => key.anyOf);

/** Et miljø med hver nøgle sat til en tilstrækkelig lang værdi. */
const KEYS_SET = Object.fromEntries(ALL_KEYS.map((name) => [name, "v".repeat(40)]));

const FLAGS_ON = {
  FLAG_BOOKING: "true",
  FLAG_VIDEO: "true",
  FLAG_PAYMENTS: "true",
  FLAG_ACCOUNTING: "true",
  FLAG_AIFOLLOWUP: "true",
  FLAG_TRANSCRIPTION: "true",
  FLAG_EMAIL: "true",
  FLAG_SMS: "true",
  FLAG_ANALYTICS: "true",
};

const MATRIX: Array<[string, Record<string, string>]> = [
  ["tomt miljø", {}],
  ["kun demo", { FLAG_DEMO: "true" }],
  ["flag uden nøgler", FLAGS_ON],
  ["nøgler uden flag", KEYS_SET],
  ["flag + nøgler", { ...FLAGS_ON, ...KEYS_SET }],
  ["demo + flag + nøgler", { FLAG_DEMO: "true", ...FLAGS_ON, ...KEYS_SET }],
  ["demo + nøgler uden flag", { FLAG_DEMO: "true", ...KEYS_SET }],
  ["demo + flag uden nøgler", { FLAG_DEMO: "true", ...FLAGS_ON }],
];

describe("launch-data.json mod adapter-factorierne", () => {
  it("har præcis de porte factorierne har — i samme rækkefølge", () => {
    expect(LAUNCH_DATA.porte.map((p) => p.key)).toEqual(listIntegrations({}).map((i) => i.key));
  });

  for (const [name, env] of MATRIX) {
    it(`scriptets udledte tilstand = factoryernes (${name})`, () => {
      const fromFactories = Object.fromEntries(listIntegrations(env).map((i) => [i.key, i.mode]));
      const fromScript = Object.fromEntries(evaluateEnv(LAUNCH_DATA as never, env).ports.map((p) => [p.key, p.mode]));
      expect(fromScript).toEqual(fromFactories);
    });
  }

  it("realAdapterBuilt afspejler virkeligheden: nøgler + flag giver rigtig netop hvor adapteren findes", () => {
    const env = { ...FLAGS_ON, ...KEYS_SET };
    for (const item of listIntegrations(env)) {
      const port = LAUNCH_DATA.porte.find((p) => p.key === item.key);
      expect(item.mode === "real", item.key).toBe(port?.realAdapterBuilt);
    }
  });

  it("demoAdapterBuilt afspejler virkeligheden: FLAG_DEMO giver demo netop hvor demoen findes", () => {
    for (const item of listIntegrations({ FLAG_DEMO: "true" })) {
      const port = LAUNCH_DATA.porte.find((p) => p.key === item.key);
      expect(item.mode === "demo", item.key).toBe(port?.demoAdapterBuilt);
    }
  });

  it("factoryKeys er præcis de nøgler factoryen læser: en af dem fjernet falder tilbage fra rigtig", () => {
    const base = { ...FLAGS_ON, ...KEYS_SET };
    for (const port of LAUNCH_DATA.porte.filter((p) => p.realAdapterBuilt)) {
      for (const requirement of port.factoryKeys) {
        const env: Record<string, string> = { ...base };
        for (const name of requirement.anyOf) delete env[name];
        const mode = listIntegrations(env).find((i) => i.key === port.key)?.mode;
        expect(mode, `${port.key} uden ${requirement.anyOf.join("/")}`).not.toBe("real");
      }
    }
  });
});

describe("tjeklistens miljøtjek: aggregator mod script", () => {
  for (const [name, env] of MATRIX) {
    it(`samme porte, samme dom (${name})`, () => {
      const report = buildReadiness({ integrations: getIntegrationOverview(env), env, rules: null, now: new Date() });
      const script = evaluateEnv(LAUNCH_DATA as never, env);
      expect(report.ports.map((p) => [p.key, p.mode, p.verdict])).toEqual(
        script.ports.map((p) => [p.key, p.mode, p.verdict]),
      );
      expect(report.demo.on).toBe(script.demoOn);
      expect(report.gate.partial).toBe(script.gate.partial);
      // Hemmelighederne: samme antal manglende (script tæller både port- og generelle).
      const aggregatorMissing = report.secrets.filter((s) => s.verdict === "blokerer").length;
      const scriptMissing = script.blockers.filter((b) => b.area === "hemmeligheder").length;
      expect(aggregatorMissing).toBe(scriptMissing);
    });
  }
});

describe("datafilens konsistens", () => {
  const envExample = readFileSync(join(root, ".env.example"), "utf8");

  it("hver miljøvariabel tjeklisten kræver er dokumenteret i .env.example", () => {
    for (const name of ALL_KEYS) {
      expect(envExample, name).toContain(`${name}=`);
    }
  });

  it("hver port har en fuld nøgleliste (aldrig en tom factoryKeys)", () => {
    for (const port of LAUNCH_DATA.porte) {
      expect(port.factoryKeys.length, port.key).toBeGreaterThan(0);
      expect(checkPortKeys({}, port).complete).toBe(false);
    }
  });

  it("beslutnings-id'erne er unikke, og hver åben beslutning har ejer, kilde og konsekvens", () => {
    const ids = LAUNCH_DATA.beslutninger.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const decision of openDecisions()) {
      expect(["ejer", "mads"]).toContain(decision.owner);
      expect(decision.title.length).toBeGreaterThan(0);
      expect(decision.consequence.length).toBeGreaterThan(0);
      expect(decision.source.length).toBeGreaterThan(0);
    }
  });

  it("en parkering har både hvem og hvornår — ellers er den ikke en parkering", () => {
    for (const decision of LAUNCH_DATA.beslutninger.filter((d) => d.parked)) {
      expect(decision.parked?.by).toBeTruthy();
      expect(decision.parked?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const port of LAUNCH_DATA.porte.filter((p) => p.accepted)) {
      expect(port.accepted?.by).toBeTruthy();
      expect(port.accepted?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("indeholder ingen hemmelige værdier — kun variabelnavne", () => {
    const raw = readFileSync(join(root, "src/server/admin/launch-data.json"), "utf8");
    expect(raw).not.toMatch(/sk_|eyJ[A-Za-z0-9]{20,}|-----BEGIN/);
  });
});
