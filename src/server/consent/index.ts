/**
 * Samtykke-model (GDPR, fase 0 / Trin 10) — arkitektur-hook.
 *
 * Dette er den typede kerne for samtykke. Selve banner-UI'et og den juridiske
 * tekst afhænger af ToS og ejer-beslutninger og bygges IKKE her.
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
