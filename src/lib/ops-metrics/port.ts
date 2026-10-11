export interface OpsMetricsQuery {
  /** Start på det korte vindue (hændelser og undtagelser). */
  since: Date;
  /** Start på vinduet for unikke aktive personer. */
  activeSince: Date;
}

export interface ExceptionTypeCount {
  /** Kun fejltypens navn (fx `TypeError`) — aldrig beskedtekst, URL eller andet fra hændelsen. */
  type: string;
  count: number;
}

export interface OpsMetrics {
  /** Alle hændelser siden `since`. */
  events: number;
  /** `$exception`-hændelser siden `since`. */
  exceptions: number;
  /** De hyppigste fejltyper siden `since` (højst tre), mest hyppige først. */
  topExceptionTypes: readonly ExceptionTypeCount[];
  /** Unikke personer med mindst én hændelse siden `activeSince`. Et tal, aldrig identiteter. */
  activePeople: number;
}

/**
 * Driftsmålinger læst fra analytics-leverandøren (PostHog EU) til `/admin/drift` (fase 5.4).
 *
 * Bevidst en SEPARAT port ved siden af skrive-porten `Analytics` (ADR 0066): den skriver
 * fire-and-forget uden at kunne fejle, denne læser og kan. Den har egen nøgle (en personal API
 * key med læse-scope, ikke projekt-ingest-nøglen) og egne fejlsemantikker. Porten returnerer
 * kun aggregater — ingen rækker, ingen person-id'er.
 */
export interface OpsMetricsProvider {
  readonly name: string;
  getOpsMetrics(query: OpsMetricsQuery): Promise<OpsMetrics>;
}
