/**
 * Go-live-tjekliste (fase 6.4, ADR 0069): hvad der står mellem os og launch, aflæst af den
 * KØRENDE konfiguration.
 *
 * Tre lag, som resten af admin-fladen (ADR 0053):
 *   - `buildReadiness` er ren: tager integrationsstatus, miljøet, reglerne og beslutningslisten
 *     som argumenter og returnerer rapporten. Det er den der testes.
 *   - `getReadiness` henter inputtet — integrationsstatus gennem adapter-factoryerne (ikke en
 *     ny mening om leverandørnøgler), reglerne gennem de eksisterende læsefunktioner — og kræver
 *     admin.
 *   - Datafilen `launch-data.json` bærer det statiske: hvilke nøgler hver port skal have, og
 *     hvilke beslutninger der er åbne.
 *
 * Rapporten indeholder navne på miljøvariabler og «sat/mangler» — aldrig en værdi, aldrig en længde.
 * En regelsektion der ikke kunne læses er `null` og tæller som en blokering: «ukendt» er ikke «klar».
 */

import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { listFeeRules, selectFeeRule } from "@/server/fees";
import { isEnabled, type FeatureFlag } from "@/server/flags";
import { readGateConfig } from "@/server/gate";
import { NOTIFICATION_TYPES } from "@/server/notifications/catalog";
import { listTemplateVersions, type TemplateVersion } from "@/server/notifications/templates";
import { listPricingRules } from "@/server/pricing";

import { getIntegrationOverview, type IntegrationOverview, type IntegrationStatus } from "./integrations";
import {
  LAUNCH_DATA,
  checkGeneralSecrets,
  checkPortKeys,
  findPort,
  openDecisions,
  parkedDecisions,
  type Env,
  type FlagIntent,
  type KeyState,
  type LaunchData,
  type LaunchDecision,
  type PortKeyStatus,
  type PortLaunchData,
} from "./launch-env";

export type Verdict = "klar" | "blokerer";

export interface PortReadiness {
  key: string;
  label: string;
  vendor: string;
  flagEnv: string;
  flagEnabled: boolean;
  adapter: string;
  mode: IntegrationStatus["mode"];
  realAdapterBuilt: boolean;
  accepted: PortLaunchData["accepted"];
  keys: PortKeyStatus;
  verdict: Verdict;
  reason: string;
}

export interface SecretRow {
  /** «Platform» eller portens navn. */
  group: string;
  label: string;
  envNames: readonly string[];
  state: KeyState;
  /** Falsk når den tilhørende port er bevidst accepteret som stub — nøglen er så ikke et krav. */
  required: boolean;
  verdict: Verdict;
}

export interface FlagReadiness {
  flag: string;
  env: string;
  enabled: boolean;
  intent: FlagIntent | null;
  note: string;
  verdict: Verdict;
  reason: string;
}

export interface RuleSection {
  versions: number;
  /** Aktiv/gældende versionsnummer, eller `null` = ingen regel gælder. */
  activeVersion: number | null;
  verdict: Verdict;
  reason: string;
}

export interface TemplateRow {
  typeKey: string;
  label: string;
  channel: "email" | "sms";
  liveVersion: number | null;
  /** Er udsendelsestidspunktet fastlagt i kataloget? Hændelsesdrevne typer har et fast svar. */
  timingSet: boolean;
}

export interface TemplateSection {
  rows: TemplateRow[];
  liveCount: number;
  totalCount: number;
  verdict: Verdict;
  reason: string;
}

export interface RuleReadiness {
  pricing: RuleSection;
  fee: RuleSection;
  templates: TemplateSection;
}

export interface GateReadiness {
  /** Adgangsporten (ADR 0020) lukker af, nu. */
  active: boolean;
  /** Slået til, men mangler hash eller hemmelighed — porten er så INAKTIV uden at nogen siger det. */
  partial: boolean;
  verdict: Verdict;
  reason: string;
}

export interface ReadinessSummary {
  /** Blokeringer pr. afsnit. */
  blockers: {
    demo: number;
    ports: number;
    secrets: number;
    flags: number;
    rules: number;
    gate: number;
    decisions: number;
  };
  totalBlockers: number;
  ready: boolean;
}

export interface ReadinessReport {
  demo: { on: boolean; verdict: Verdict };
  ports: PortReadiness[];
  secrets: SecretRow[];
  flags: FlagReadiness[];
  /** `null` = reglerne kunne ikke læses (ingen Supabase eller en fejl) — og det tæller som blokering. */
  rules: RuleReadiness | null;
  gate: GateReadiness;
  decisions: { open: LaunchDecision[]; parked: LaunchDecision[] };
  summary: ReadinessSummary;
}

export interface RuleInputs {
  pricing: ReadonlyArray<{ version: number; isActive: boolean }>;
  fee: ReadonlyArray<{ version: number; effectiveFrom: string }>;
  templates: readonly TemplateVersion[];
}

export interface ReadinessInput {
  integrations: IntegrationOverview;
  env: Env;
  /** `null` når reglerne ikke kunne læses. */
  rules: RuleInputs | null;
  now: Date;
  data?: LaunchData;
}

const blockers = (items: ReadonlyArray<{ verdict: Verdict }>): number =>
  items.filter((item) => item.verdict === "blokerer").length;

function portReason(port: PortLaunchData, item: IntegrationStatus, keys: PortKeyStatus): string {
  if (item.mode === "demo") return "Kører som demo (FLAG_DEMO) — skal være en rigtig integration.";
  if (item.mode === "real") {
    return keys.complete
      ? "Kører mod leverandøren."
      : "Kører, men en tilhørende hemmelighed mangler — se hemmeligheder nedenfor.";
  }
  if (port.accepted) return `Bevidst stub — accepteret af ${port.accepted.by}, ${port.accepted.date}.`;
  if (!port.realAdapterBuilt) return "Der findes ingen rigtig adapter i koden endnu.";
  if (!item.flagEnabled) return `Flaget er slukket (${item.flagEnv}).`;
  return "Flaget er tændt, men nøglerne mangler.";
}

function buildPorts(input: ReadinessInput, data: LaunchData): PortReadiness[] {
  return input.integrations.integrations.map((item) => {
    const port = findPort(item.key, data);
    // En port uden post i datafilen er et hul i tjeklisten selv — fejl højlydt som blokering.
    if (!port) {
      return {
        key: item.key,
        label: item.label,
        vendor: item.vendor,
        flagEnv: item.flagEnv,
        flagEnabled: item.flagEnabled,
        adapter: item.adapter,
        mode: item.mode,
        realAdapterBuilt: false,
        accepted: null,
        keys: { portKey: item.key, factory: [], other: [], complete: false },
        verdict: "blokerer" as const,
        reason: "Porten findes ikke i launch-data.json — tjeklisten kender ikke dens nøgler.",
      };
    }
    const keys = checkPortKeys(input.env, port);
    const verdict: Verdict =
      item.mode === "real" ? (keys.complete ? "klar" : "blokerer") : item.mode === "stub" && port.accepted ? "klar" : "blokerer";
    return {
      key: item.key,
      label: item.label,
      vendor: item.vendor,
      flagEnv: item.flagEnv,
      flagEnabled: item.flagEnabled,
      adapter: item.adapter,
      mode: item.mode,
      realAdapterBuilt: port.realAdapterBuilt,
      accepted: port.accepted,
      keys,
      verdict,
      reason: portReason(port, item, keys),
    };
  });
}

function buildSecrets(input: ReadinessInput, data: LaunchData, ports: readonly PortReadiness[]): SecretRow[] {
  const rows: SecretRow[] = checkGeneralSecrets(input.env, data).map((status) => ({
    group: "Platform",
    label: status.label,
    envNames: status.envNames,
    state: status.state,
    required: true,
    verdict: status.state === "sat" ? ("klar" as const) : ("blokerer" as const),
  }));
  for (const port of ports) {
    // Et accepteret stub-hul kræver ingen nøgler; alt andet gør.
    const required = !(port.mode === "stub" && port.accepted);
    for (const status of [...port.keys.factory, ...port.keys.other]) {
      rows.push({
        group: port.label,
        label: status.label,
        envNames: status.envNames,
        state: status.state,
        required,
        verdict: !required || status.state === "sat" ? "klar" : "blokerer",
      });
    }
  }
  return rows;
}

function buildFlags(input: ReadinessInput, data: LaunchData): FlagReadiness[] {
  return data.oevrigeFlag.map((entry) => {
    const enabled = isEnabled(entry.flag as FeatureFlag, input.env);
    let verdict: Verdict = "klar";
    let reason = enabled ? "Tændt." : "Slukket.";
    if (entry.intent === null) {
      verdict = "blokerer";
      reason = "Ikke dokumenteret som bevidst tændt eller slukket (docs/fase-6.md §6.4).";
    } else if ((entry.intent === "tændt") !== enabled) {
      verdict = "blokerer";
      reason = `Er ${enabled ? "tændt" : "slukket"}, men dokumenteret som bevidst ${entry.intent}.`;
    }
    return { flag: entry.flag, env: entry.env, enabled, intent: entry.intent, note: entry.note, verdict, reason };
  });
}

function buildRules(rules: RuleInputs, now: Date): RuleReadiness {
  const activePricing = rules.pricing.find((rule) => rule.isActive) ?? null;
  const pricing: RuleSection = {
    versions: rules.pricing.length,
    activeVersion: activePricing?.version ?? null,
    verdict: activePricing ? "klar" : "blokerer",
    reason: activePricing
      ? `Version ${activePricing.version} er aktiv.`
      : rules.pricing.length === 0
        ? "Ingen prisregel findes — prisen er ikke fastsat."
        : "Ingen version er aktiv.",
  };

  const currentFee = selectFeeRule(rules.fee, now);
  const fee: RuleSection = {
    versions: rules.fee.length,
    activeVersion: currentFee?.version ?? null,
    verdict: currentFee ? "klar" : "blokerer",
    reason: currentFee
      ? `Version ${currentFee.version} gælder i dag.`
      : rules.fee.length === 0
        ? "Ingen honorarregel findes — honorarsatsen er ikke fastsat."
        : "Ingen honorarregel gælder endnu i dag.",
  };

  const live = new Map<string, number>();
  for (const version of rules.templates) {
    if (version.status === "live") live.set(`${version.typeKey}/${version.channel}`, version.version);
  }
  const rows: TemplateRow[] = NOTIFICATION_TYPES.flatMap((type) =>
    type.channels.map((channel) => ({
      typeKey: type.key,
      label: type.label,
      channel,
      liveVersion: live.get(`${type.key}/${channel}`) ?? null,
      timingSet: type.timing !== null,
    })),
  );
  const liveCount = rows.filter((row) => row.liveVersion !== null).length;
  const templates: TemplateSection = {
    rows,
    liveCount,
    totalCount: rows.length,
    verdict: liveCount === rows.length ? "klar" : "blokerer",
    reason:
      liveCount === rows.length
        ? "Alle beskedtyper har en live skabelon pr. kanal."
        : `${rows.length - liveCount} af ${rows.length} kombinationer af type og kanal mangler en live skabelon.`,
  };

  return { pricing, fee, templates };
}

function buildGate(env: Env): GateReadiness {
  const config = readGateConfig(env);
  const active = config.enabled && config.passwordHash !== null && config.cookieSecret !== null;
  const partial = config.enabled && !active;
  return {
    active,
    partial,
    verdict: partial ? "blokerer" : "klar",
    reason: partial
      ? "Slået til, men hash eller cookie-hemmelighed mangler — porten er derfor INAKTIV (ADR 0020)."
      : active
        ? "Aktiv: besøgende møder adgangsporten. Bekræft at det er ønsket ved launch."
        : "Slukket. Bekræft at det er ønsket ved launch.",
  };
}

/** Den rene rapport. Ingen I/O. */
export function buildReadiness(input: ReadinessInput): ReadinessReport {
  const data = input.data ?? LAUNCH_DATA;
  const ports = buildPorts(input, data);
  const secrets = buildSecrets(input, data, ports);
  const flags = buildFlags(input, data);
  const rules = input.rules ? buildRules(input.rules, input.now) : null;
  const gate = buildGate(input.env);
  const decisions = { open: openDecisions(data), parked: parkedDecisions(data) };
  const demo = {
    on: input.integrations.demoMode,
    verdict: input.integrations.demoMode ? ("blokerer" as const) : ("klar" as const),
  };

  const counts = {
    demo: demo.verdict === "blokerer" ? 1 : 0,
    ports: blockers(ports),
    secrets: blockers(secrets),
    flags: blockers(flags),
    // En regelsektion der ikke kan læses er ukendt, ikke klar: den tæller som én blokering.
    rules: rules ? blockers([rules.pricing, rules.fee, rules.templates]) : 1,
    gate: blockers([gate]),
    decisions: decisions.open.length,
  };
  const totalBlockers = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return {
    demo,
    ports,
    secrets,
    flags,
    rules,
    gate,
    decisions,
    summary: { blockers: counts, totalBlockers, ready: totalBlockers === 0 },
  };
}

async function loadRules(env: Env): Promise<RuleInputs | null> {
  if (!isSupabaseAuthConfigured(readSupabaseAuthConfig(env))) return null;
  try {
    const [pricing, fee, templates] = await Promise.all([
      listPricingRules(env),
      listFeeRules(env),
      listTemplateVersions(undefined, env),
    ]);
    return { pricing, fee, templates };
  } catch (e) {
    console.error(`[admin/klar] reglerne kunne ikke læses: ${e instanceof Error ? e.name : "ukendt"}`);
    return null;
  }
}

/**
 * Hent rapporten til /admin/klar. Kræver admin (andet lag efter `/admin/layout.tsx`); reglerne
 * læses gennem den authede klient, så RLS afgør hvad der er synligt.
 */
export async function getReadiness(env: Env = process.env, now: Date = new Date()): Promise<ReadinessReport> {
  requireRole(await getCurrentUser(env), "admin");
  return buildReadiness({
    integrations: getIntegrationOverview(env),
    env,
    rules: await loadRules(env),
    now,
  });
}
