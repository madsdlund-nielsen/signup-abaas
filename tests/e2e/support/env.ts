/**
 * Miljø for e2e-kørslen (fase 6.1, ADR 0071).
 *
 * To kilder til den lokale Supabase-stak, i denne rækkefølge:
 *   1. E2E_SUPABASE_*-variabler (CI, eller en stak der kører et andet sted end CLI'ens default),
 *   2. `supabase status -o env --workdir tests/e2e` — nøglerne genereres af CLI'en ved hver
 *      `supabase start`, så der ligger aldrig en nøgle i repoet.
 *
 * VÆRN: global-setup nulstiller databasen. Derfor nægter vi at køre mod alt andet end loopback,
 * uanset hvad miljøet siger. Det her må aldrig kunne ramme et rigtigt Supabase-projekt.
 */

import { execFileSync } from "node:child_process";

export interface SupabaseEnv {
  apiUrl: string;
  /** Den offentlige nøgle (sb_publishable_…) — appens NEXT_PUBLIC_SUPABASE_ANON_KEY. */
  publishableKey: string;
  /** Den hemmelige nøgle (sb_secret_…) — appens SUPABASE_SERVICE_ROLE_KEY. */
  secretKey: string;
  dbUrl: string;
  /** Mailpit/Inbucket — her lander alle mails fra Supabase Auth. */
  mailUrl: string;
}

export const APP_PORT = 3100;
export const APP_URL = `http://localhost:${APP_PORT}`;

/** Repo-roden: Playwright og npm-scripts køres altid derfra (playwright.config.ts ligger der). */
export const REPO_ROOT = `${process.cwd()}/`;
export const E2E_WORKDIR = "tests/e2e";

/** Åbenlyst falsk hemmelighed, kun til lokal kørsel (≥ 32 tegn, ellers er linkene slået fra). */
export const E2E_RATING_LINK_SECRET = "e2e-only-not-a-secret-rating-link-hmac-0123456789";
export const E2E_CRON_SECRET = "e2e-only-not-a-secret-cron";
/** Webhook-hemmeligheder (kun lokalt): uden dem svarer endpoints 503. De aktiverer ingen adapter. */
export const E2E_CALCOM_WEBHOOK_SECRET = "e2e-only-not-a-secret-calcom-webhook";
export const E2E_ALUNTA_WEBHOOK_SECRET = "e2e-only-not-a-secret-alunta-webhook";

function parseEnvOutput(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) result[match[1] as string] = match[2] as string;
  }
  return result;
}

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

let cached: SupabaseEnv | undefined;

export function loadSupabaseEnv(): SupabaseEnv {
  if (cached) return cached;

  const fromEnv = process.env.E2E_SUPABASE_URL
    ? {
        apiUrl: process.env.E2E_SUPABASE_URL,
        publishableKey: process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? "",
        secretKey: process.env.E2E_SUPABASE_SECRET_KEY ?? "",
        dbUrl: process.env.E2E_SUPABASE_DB_URL ?? "",
        mailUrl: process.env.E2E_MAIL_URL ?? "http://127.0.0.1:54324",
      }
    : null;

  let env: SupabaseEnv;
  if (fromEnv) {
    env = fromEnv;
  } else {
    let output: string;
    try {
      output = execFileSync("npx", ["--yes", "supabase", "status", "-o", "env", "--workdir", E2E_WORKDIR], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      throw new Error(
        "Den lokale Supabase-stak kører ikke. Start den først: `npm run e2e:db:up` " +
          "(docs/e2e.md). Alternativt sæt E2E_SUPABASE_URL/-PUBLISHABLE_KEY/-SECRET_KEY/-DB_URL.",
      );
    }
    const parsed = parseEnvOutput(output);
    env = {
      apiUrl: parsed.API_URL ?? "",
      publishableKey: parsed.PUBLISHABLE_KEY ?? parsed.ANON_KEY ?? "",
      secretKey: parsed.SECRET_KEY ?? parsed.SERVICE_ROLE_KEY ?? "",
      dbUrl: parsed.DB_URL ?? "",
      mailUrl: parsed.MAILPIT_URL ?? parsed.INBUCKET_URL ?? "http://127.0.0.1:54324",
    };
  }

  for (const [name, value] of Object.entries(env)) {
    if (!value) throw new Error(`E2E: ${name} mangler fra Supabase-miljøet.`);
  }
  if (!isLoopback(env.apiUrl) || !isLoopback(env.dbUrl.replace(/^postgres(ql)?:/, "http:"))) {
    throw new Error(
      `E2E nægter at køre mod ${env.apiUrl}: nulstilling af databasen må kun ramme en lokal stak (loopback).`,
    );
  }

  cached = env;
  return env;
}

/**
 * Leverandør-variabler der ALDRIG må arves fra udviklerens shell eller `.env.local`: en rigtig
 * nøgle ville vinde over demo-adapteren (ADR 0041) og e2e-kørslen ville kalde en rigtig leverandør.
 * Tom streng vinder over Next's .env-indlæsning (den sætter kun variabler der ikke er defineret).
 */
const VENDOR_VARS = [
  "FLAG_BOOKING",
  "FLAG_VIDEO",
  "FLAG_PAYMENTS",
  "FLAG_ACCOUNTING",
  "FLAG_AIFOLLOWUP",
  "FLAG_TRANSCRIPTION",
  "FLAG_EMAIL",
  "FLAG_SMS",
  "FLAG_ANALYTICS",
  "APP_GATE_ENABLED",
  "APP_GATE_PASSWORD_HASH",
  "APP_GATE_COOKIE_SECRET",
  "CALCOM_API_KEY",
  "CALCOM_TEAM_ID",
  "CALCOM_API_URL",
  "CALCOM_WEBHOOK_SECRET",
  "CALVIDEO_API_KEY",
  "ALUNTA_API_KEY",
  "ALUNTA_PLAN_ID",
  "ALUNTA_API_URL",
  "ALUNTA_WEBHOOK_SECRET",
  "ACCOUNTING_API_KEY",
  "ORDBOGEN_API_KEY",
  "ORDBOGEN_API_URL",
  "ORDBOGEN_LLM_MODEL",
  "ORDBOGEN_TRANSCRIPTION_MODEL",
  "LLM_API_KEY",
  "TRANSCRIPTION_API_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_ADDRESS",
  "INMOBILE_API_KEY",
  "INMOBILE_SENDER",
  "POSTHOG_KEY",
  "POSTHOG_HOST",
  "POSTHOG_PERSONAL_API_KEY",
  "POSTHOG_PROJECT_ID",
  "POSTHOG_API_HOST",
  "DATABASE_URL",
];

/** Miljøet appen bygges og startes med. Demo-tilstand + lokal Supabase, ingen leverandører. */
export function appEnv(): Record<string, string> {
  const supabase = loadSupabaseEnv();
  const blanked = Object.fromEntries(VENDOR_VARS.map((name) => [name, ""]));
  return {
    ...blanked,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: supabase.apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: supabase.secretKey,
    NEXT_PUBLIC_APP_URL: APP_URL,
    // Demo-adaptere i stedet for leverandører (ADR 0041) — den eneste måde rejsen kan klikkes
    // igennem uden konti. Lead-partner-markering tændes så den rolle også kan gennemspilles.
    FLAG_DEMO: "true",
    FLAG_LEADPARTNER: "true",
    RATING_LINK_SECRET: E2E_RATING_LINK_SECRET,
    CRON_SECRET: E2E_CRON_SECRET,
    CALCOM_WEBHOOK_SECRET: E2E_CALCOM_WEBHOOK_SECRET,
    ALUNTA_WEBHOOK_SECRET: E2E_ALUNTA_WEBHOOK_SECRET,
  };
}
