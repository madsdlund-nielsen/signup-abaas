import { isEnabled } from "@/server/flags";
import { readConsentChoice, type ConsentState } from "@/server/consent";

/**
 * Browser-PostHog (ADR 0072). Værterne er KONSTANTER, ikke env: dataresidensen er EU og skal ikke
 * kunne skifte ved en tastefejl i en env var — og CSP'en (src/server/security/headers.ts) skal
 * kende præcis de samme domæner.
 */
export const POSTHOG_BROWSER_HOST = "https://eu.i.posthog.com";
export const POSTHOG_ASSETS_HOST = "https://eu-assets.i.posthog.com";
export const POSTHOG_UI_HOST = "https://eu.posthog.com";

export interface BrowserAnalyticsConfig {
  /** Projektets offentlige ingest-nøgle (`phc_…`) — skriver kun, kan ikke læse. */
  apiKey: string;
}

/**
 * Er der ikke-nødvendige cookies at spørge om? Kun når analytics er slået til (`FLAG_ANALYTICS`)
 * OG browser-nøglen er sat. Ellers `null`: intet banner, ingen SDK, ingen CSP-åbning.
 */
export function readBrowserAnalyticsConfig(
  env: Record<string, string | undefined> = process.env,
): BrowserAnalyticsConfig | null {
  const apiKey = env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (!isEnabled("analytics", env) || !apiKey) return null;
  return { apiKey };
}

export interface ConsentBoot {
  apiKey: string;
  /** Det gemte valg, eller `null` hvis besøgende endnu ikke har valgt. */
  initial: ConsentState | null;
}

/** Det rodlayoutet har brug for: `null` = render intet. `cookieValue` er samtykkecookiens værdi. */
export function resolveConsentBoot(
  env: Record<string, string | undefined>,
  cookieValue: string | undefined,
): ConsentBoot | null {
  const config = readBrowserAnalyticsConfig(env);
  if (!config) return null;
  return { apiKey: config.apiKey, initial: readConsentChoice(cookieValue) };
}
