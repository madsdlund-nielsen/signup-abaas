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
