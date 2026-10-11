/**
 * Fælles adapter-fejl. Kastes af stub-implementeringer når en operation kræver
 * en rigtig backend (nøgler/konto), som endnu ikke er konfigureret.
 */
export class NotConfiguredError extends Error {
  constructor(
    public readonly vendor: string,
    public readonly operation?: string,
  ) {
    super(
      `Adapter '${vendor}' er ikke konfigureret` +
        (operation ? ` (operation: ${operation})` : "") +
        ". Stub-implementeringen kan ikke udføre ægte kald — mangler flag/nøgler.",
    );
    this.name = "NotConfiguredError";
  }
}

/**
 * Transskription forsøgt uden grundlag for mødeoptagelse. Siden 2026-10-11 (ADR 0065) er
 * grundlaget kontrakten (`getRecordingConsent` → `basis: "kontrakt"` for et møde der findes);
 * mangler det, fx for et ukendt møde, fejler kodestien lukket og må aldrig stubbes eller omgås
 * (CLAUDE.md, stub-politik).
 */
export class RecordingConsentMissingError extends Error {
  constructor(public readonly meetingId: string) {
    super(
      "Intet grundlag (kontrakt) for mødeoptagelse er registreret for dette møde — transskription afvist. " +
        "Der sendes ingen lyd til leverandøren uden grundlag.",
    );
    this.name = "RecordingConsentMissingError";
  }
}

/** Samtykke findes, men der er ingen optagelse at transskribere (Cal.com-optagelse ikke verificeret, L-8). */
export class MissingRecordingError extends Error {
  constructor(public readonly meetingId: string) {
    super("Mødets optagelse er ikke tilgængelig — der er ingen lyd at transskribere.");
    this.name = "MissingRecordingError";
  }
}

/**
 * Et kald til en KONFIGURERET leverandør fejlede. `retryable` skelner en forbigående fejl
 * (netværk, 429, 5xx — prøv igen) fra en endelig (4xx — adressen er ugyldig, nøglen er
 * afvist; at prøve igen ændrer ikke svaret). Kalderen bestemmer selv om og hvor mange gange
 * der prøves; adapteren fortæller kun hvad slags fejl det var.
 *
 * Beskeden må ikke bære modtagerens adresse: leverandørens svartekst skrubbes af kalderen
 * (`src/server/notifications/scrub.ts`) før den gemmes eller rapporteres.
 */
export class ProviderError extends Error {
  constructor(
    public readonly vendor: string,
    public readonly operation: string,
    /** HTTP-status, eller null hvis forbindelsen aldrig gav et svar. */
    public readonly status: number | null,
    detail: string,
    public readonly retryable: boolean,
  ) {
    super(
      `${vendor} ${operation} fejlede` +
        (status === null ? " (ingen forbindelse)" : ` (HTTP ${status})`) +
        (detail ? `: ${detail.slice(0, 300)}` : ""),
    );
    this.name = "ProviderError";
  }
}

/** HTTP-statusser hvor et nyt forsøg giver mening: timeout, rate limit og serverfejl. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
