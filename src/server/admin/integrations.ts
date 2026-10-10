/**
 * Integrationsstatus til driftsoverblikket (fase 5.4, ADR 0053).
 *
 * Hver port i `src/lib/` spørges om sin egen tilstand (`createX(env).name`) — vi læser
 * ikke leverandørernes env-nøgler en gang til. Nøglenavnene bor ét sted, i adapterens
 * factory, og en driftsskærm der har sin egen mening om hvad der er konfigureret, kan
 * komme til at lyve efter et adapter-skift. Samme greb som notifikationsoversigten
 * (ADR 0048), udvidet fra to kanaler til alle ni porte.
 *
 * Tre tilstande, jf. ADR 0041:
 *   - real: en rigtig adapter (flag tændt og config til stede)
 *   - demo: FLAG_DEMO er tændt og den rigtige config mangler — åbenlyst falsk data
 *   - stub: intet af ovenstående; backend-stubs kaster, fire-and-forget-stubs logger
 *
 * Læser kun tilstand; kalder aldrig en adapter-operation.
 */

import { createAccountingExporter } from "@/lib/accounting";
import { createAnalytics } from "@/lib/analytics";
import { createBookingProvider } from "@/lib/booking";
import { createEmailSender } from "@/lib/email";
import { createLlmProvider } from "@/lib/llm";
import { createPaymentProvider } from "@/lib/payments";
import { createSmsSender } from "@/lib/sms";
import { createTranscriptionProvider } from "@/lib/transcription";
import { createVideoProvider } from "@/lib/video";
import { isDemoMode, isEnabled, type FeatureFlag } from "@/server/flags";

type Env = Record<string, string | undefined>;

export type IntegrationMode = "real" | "demo" | "stub";

export interface IntegrationStatus {
  key: string;
  label: string;
  vendor: string;
  flag: FeatureFlag;
  /** Env-variablen flaget læses fra, så admin kan se hvad der skal sættes. */
  flagEnv: string;
  flagEnabled: boolean;
  mode: IntegrationMode;
  /** Adapterens eget navn (`calcom`, `alunta`, `demo`, `stub` …). */
  adapter: string;
}

export interface IntegrationOverview {
  integrations: readonly IntegrationStatus[];
  /** FLAG_DEMO — skal være slået fra ved launch (docs/fase-6.md §6.4). */
  demoMode: boolean;
  counts: Record<IntegrationMode, number>;
}

/** Adapterens navn → tilstand. Alt andet end `stub`/`demo` er en rigtig integration. */
export function classifyAdapter(name: string): IntegrationMode {
  if (name === "stub") return "stub";
  if (name === "demo") return "demo";
  return "real";
}

export function flagEnvName(flag: FeatureFlag): string {
  return `FLAG_${flag.toUpperCase()}`;
}

/** Tæl tilstande — ren funktion, så sammentællingen kan testes uden adaptere. */
export function countModes(
  items: readonly Pick<IntegrationStatus, "mode">[],
): Record<IntegrationMode, number> {
  const counts: Record<IntegrationMode, number> = { real: 0, demo: 0, stub: 0 };
  for (const item of items) counts[item.mode] += 1;
  return counts;
}

interface PortDefinition {
  key: string;
  label: string;
  vendor: string;
  flag: FeatureFlag;
  adapterName: (env: Env) => string;
}

/**
 * Rækkefølgen følger CLAUDE.md's teknologitabel. Leverandørnavnene er den låste stak —
 * regnskab er bevidst skrevet som uafgjort (ejer-punkt), ikke som et valg.
 */
const PORTS: readonly PortDefinition[] = [
  {
    key: "booking",
    label: "Booking",
    vendor: "Cal.com (Teams)",
    flag: "booking",
    adapterName: (env) => createBookingProvider(env).name,
  },
  {
    key: "video",
    label: "Video",
    vendor: "Cal Video",
    flag: "video",
    adapterName: (env) => createVideoProvider(env).name,
  },
  {
    key: "payments",
    label: "Betaling ind",
    vendor: "Alunta → QuickPay → Nets",
    flag: "payments",
    adapterName: (env) => createPaymentProvider(env).name,
  },
  {
    key: "accounting",
    label: "Bogføring",
    vendor: "e-conomic eller Dinero (ikke afgjort)",
    flag: "accounting",
    adapterName: (env) => createAccountingExporter(env).name,
  },
  {
    key: "llm",
    label: "AI-opfølgning",
    vendor: "Ordbogen (Odin-LLM)",
    flag: "aiFollowup",
    adapterName: (env) => createLlmProvider(env).name,
  },
  {
    key: "transcription",
    label: "Transskription",
    vendor: "Ordbogen",
    flag: "transcription",
    adapterName: (env) => createTranscriptionProvider(env).name,
  },
  {
    key: "email",
    label: "E-mail",
    vendor: "Resend (EU, Dublin)",
    flag: "email",
    adapterName: (env) => createEmailSender(env).name,
  },
  {
    key: "sms",
    label: "SMS",
    vendor: "inMobile (DK)",
    flag: "sms",
    adapterName: (env) => createSmsSender(env).name,
  },
  {
    key: "analytics",
    label: "Analytics",
    vendor: "PostHog (EU)",
    flag: "analytics",
    adapterName: (env) => createAnalytics(env).name,
  },
];

export function listIntegrations(env: Env = process.env): readonly IntegrationStatus[] {
  return PORTS.map((port) => {
    const adapter = port.adapterName(env);
    return {
      key: port.key,
      label: port.label,
      vendor: port.vendor,
      flag: port.flag,
      flagEnv: flagEnvName(port.flag),
      flagEnabled: isEnabled(port.flag, env),
      mode: classifyAdapter(adapter),
      adapter,
    };
  });
}

export function getIntegrationOverview(env: Env = process.env): IntegrationOverview {
  const integrations = listIntegrations(env);
  return { integrations, demoMode: isDemoMode(env), counts: countModes(integrations) };
}
