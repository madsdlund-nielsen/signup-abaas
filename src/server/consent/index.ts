/**
 * Samtykke-model (GDPR, fase 0 / Trin 10) — arkitektur-hook.
 *
 * Dette er den typede kerne for samtykke. Banneret (src/components/CookieBanner.tsx, ADR 0072)
 * og det samtykke-gatede browser-PostHog (src/lib/analytics/) bygger på den; den juridiske
 * tekst afhænger af ToS og ejer-beslutninger.
 * TODO(ejer): samtykketekst + ToS + endelig kategori-liste (CLAUDE.md, uafklarede punkter).
 *
 * GDPR-princip: opt-in. Kun "nødvendig" er aktiv som standard; alt andet kræver
 * et aktivt valg fra brugeren. Adaptere/moduler bør gate sig selv på samtykke
 * (fx må analytics først sende når `analytics`-samtykke er givet).
 */

export type ConsentCategory = "necessary" | "functional" | "analytics";

export const CONSENT_CATEGORIES: readonly ConsentCategory[] = [
  "necessary",
  "functional",
  "analytics",
] as const;

export interface ConsentState {
  /** Altid sand — nødvendig databehandling kan ikke fravælges. */
  necessary: true;
  functional: boolean;
  analytics: boolean;
}

/** Standard: kun nødvendig. Resten kræver aktivt opt-in. */
export function defaultConsent(): ConsentState {
  return { necessary: true, functional: false, analytics: false };
}

export function hasConsent(state: ConsentState, category: ConsentCategory): boolean {
  return category === "necessary" ? true : state[category];
}

/** Læs samtykke fra en lagret værdi (fx cookie). Ukendt/ugyldig → standard. */
export function parseConsent(raw: string | null | undefined): ConsentState {
  if (!raw) return defaultConsent();
  try {
    const parsed = JSON.parse(raw) as Partial<Record<ConsentCategory, unknown>>;
    return {
      necessary: true,
      functional: parsed.functional === true,
      analytics: parsed.analytics === true,
    };
  } catch {
    return defaultConsent();
  }
}

/** Serialisér til lagring. Kun de valgbare kategorier gemmes. */
export function serializeConsent(state: ConsentState): string {
  return JSON.stringify({ functional: state.functional, analytics: state.analytics });
}

/** Førstepartscookien der husker besøgendes valg (ADR 0072). Strengt nødvendig: den husker et nej. */
export const CONSENT_COOKIE = "abaas_consent";

/**
 * Cookiens levetid: 12 måneder. Teknisk default, ikke en juridisk afgørelse — hvor længe et
 * samtykke må stå før der spørges igen er ejerens/jurists valg.
 * TODO(ejer): samtykkets levetid (12 mdr. er en teknisk default).
 */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Browser-events: banneret melder et valg; footerlinket beder banneret åbne igen. */
export const CONSENT_CHANGED_EVENT = "abaas:consent-changed";
export const CONSENT_OPEN_EVENT = "abaas:consent-open";

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Har besøgende truffet et valg? `parseConsent` kan ikke svare — den giver standard (kun
 * nødvendig) både for «ikke valgt» og for «valgte kun nødvendige». Her er `null` = ikke valgt
 * (ingen cookie, ugyldig eller ikke et objekt med boolske felter), og så skal der spørges.
 * Tåler både rå JSON og den URL-kodede cookieværdi.
 */
export function readConsentChoice(raw: string | null | undefined): ConsentState | null {
  if (!raw) return null;
  for (const candidate of [raw, safeDecode(raw)]) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown> | null;
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        typeof parsed.analytics === "boolean" &&
        typeof parsed.functional === "boolean"
      ) {
        return parseConsent(candidate);
      }
    } catch {
      // prøv næste kandidat
    }
  }
  return null;
}

/** Hele `Set-Cookie`/`document.cookie`-strengen for et valg. `Secure` kun over https. */
export function buildConsentCookie(state: ConsentState, opts: { secure: boolean }): string {
  return [
    `${CONSENT_COOKIE}=${encodeURIComponent(serializeConsent(state))}`,
    `Max-Age=${CONSENT_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
    ...(opts.secure ? ["Secure"] : []),
  ].join("; ");
}
