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
 * Transskription forsøgt uden registreret samtykke til mødeoptagelse. Samtykke er ejerens
 * punkt og må aldrig stubbes eller omgås — kodestien fejler lukket (CLAUDE.md, stub-politik).
 * TODO(ejer): samtykke til mødeoptagelse — mekanismen findes ikke endnu.
 */
export class RecordingConsentMissingError extends Error {
  constructor(public readonly meetingId: string) {
    super(
      "Samtykke til mødeoptagelse er ikke registreret for dette møde — transskription afvist. " +
        "Der sendes ingen lyd til leverandøren uden samtykke.",
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
