/**
 * Honorarberegning (Fase 5.1, ADR 0051). Byggespec §4/§5.10: en partner honoreres for et afholdt
 * møde på grundlag af 75 min (60 min møde + 15 min betalt forberedelse). Satsen kommer fra den
 * honorarregel admin har indtastet — der findes ingen tal her (stub-politik).
 *
 * BEVIDST REN: ingen Supabase-, env- eller React-afhængigheder, samme grænse som
 * `src/server/pricing/algorithm.ts` — unit-testbar uden DB.
 *
 *   honorar = round(sats_pr_time × (mødeminutter + forberedelsesminutter) / 60)
 *
 * Resultatet er en diskrimineret union, så en skærm aldrig kan forveksle "0 kr" med "ikke
 * beregnet": hvert tilfælde hvor der ikke kan stå et beløb har sin egen `kind`.
 *
 * TODO(ejer): honorarsats pr. partner pr. møde (§12 pkt. 1) — satsen er reglens, ikke kodens.
 * TODO(ejer): moms på partner-honorar (§12 pkt. 14) — `vatMode` videregives, men der beregnes
 *   ALDRIG en momssats her; om 25 % skal lægges til eller trækkes fra er ejerens/bogholderens
 *   anvendelse af reglen, ikke et tal i kode.
 * TODO(ejer): honorar ved udeblivelse/sent afbud (§12 pkt. 13) — grundlaget registreres;
 *   konsekvensen beregnes kun når `absenceRule` er sat af admin.
 */

export type FeeVatMode = "ikke_fastlagt" | "ekskl_moms" | "inkl_moms";
export type FeeAbsenceRule = "ikke_fastlagt" | "intet_honorar" | "fuldt_honorar";
export type FeeMeetingStatus = "planlagt" | "aflyst" | "afholdt";
export type FeeRegisteredStatus = "afholdt" | "forsinket_afbud" | "udeblivelse";

export interface FeeRuleInput {
  id: string;
  version: number;
  /** Honorarsats i øre pr. time. */
  hourlyRateMinor: number;
  currency: string;
  vatMode: FeeVatMode;
  absenceRule: FeeAbsenceRule;
  /** ISO-tidspunkt reglen gælder fra (inklusive). */
  effectiveFrom: string;
}

export interface FeeLineInput {
  durationMinutes: number;
  prepMinutes: number;
  /** Partnerens egen registrering pr. møde (ADR 0026) — null indtil registreret. */
  registeredStatus: FeeRegisteredStatus | null;
  meetingStatus: FeeMeetingStatus;
}

export type FeeComputation =
  /** Beløbet kan stå: reglen gælder, og registreringen giver grundlag. */
  | {
      kind: "beregnet";
      amountMinor: number;
      currency: string;
      /** Minutter der er regnet på (møde + forberedelse). */
      basisMinutes: number;
      /** Hvad beløbet bygger på — 'afholdt', eller en afbudsregistrering der er afgjort af reglen. */
      basis: FeeRegisteredStatus;
      /** Gengivet fra reglen. Der er ikke regnet moms; se TODO(ejer) øverst. */
      vatMode: FeeVatMode;
      ruleVersion: number;
    }
  /** Forsinket afbud/udeblivelse mens reglen endnu ikke er fastlagt: grundlaget er registreret, konsekvensen ikke beregnet. */
  | {
      kind: "afventer_regel";
      basis: "forsinket_afbud" | "udeblivelse";
      basisMinutes: number;
      ruleVersion: number;
    }
  /** Ingen honorarregel gælder for mødetidspunktet — satsen er ikke fastsat (for dette tidspunkt). */
  | { kind: "ingen_sats" }
  /** Partneren har ikke registreret mødet endnu — der er intet grundlag. */
  | { kind: "ikke_registreret" }
  /** Mødet er aflyst — der er intet honorargrundlag, uanset registrering. */
  | { kind: "aflyst" };

/**
 * Vælg den regel et møde afregnes efter: den med senest `effectiveFrom` som ikke ligger efter
 * mødets start. Deterministisk og uafhængig af rækkefølgen i `rules`. null hvis ingen gælder.
 */
export function selectFeeRule<R extends Pick<FeeRuleInput, "effectiveFrom">>(
  rules: readonly R[],
  startsAt: string | Date,
): R | null {
  const at = new Date(startsAt).getTime();
  if (Number.isNaN(at)) throw new Error(`Ugyldigt mødetidspunkt: ${String(startsAt)}.`);

  let best: R | null = null;
  let bestFrom = -Infinity;
  for (const rule of rules) {
    const from = new Date(rule.effectiveFrom).getTime();
    if (Number.isNaN(from)) throw new Error(`Ugyldigt gyldighedstidspunkt: ${rule.effectiveFrom}.`);
    if (from <= at && from > bestFrom) {
      best = rule;
      bestFrom = from;
    }
  }
  return best;
}

/** Beløb for et grundlag i minutter. Kaster ved ugyldigt input — hellere højlydt end et forkert beløb. */
export function feeAmountMinor(hourlyRateMinor: number, basisMinutes: number): number {
  if (!Number.isInteger(hourlyRateMinor) || hourlyRateMinor < 0) {
    throw new Error(`Ugyldig honorarsats: ${hourlyRateMinor}.`);
  }
  if (!Number.isInteger(basisMinutes) || basisMinutes < 0) {
    throw new Error(`Ugyldigt honorargrundlag: ${basisMinutes} min.`);
  }
  return Math.round((hourlyRateMinor * basisMinutes) / 60);
}

/**
 * Beregn én partners honorar for ét møde. Rækkefølgen er bevidst: først om der overhovedet er
 * et grundlag (aflyst / ikke registreret), så om der er en sats, og først derefter hvad
 * registreringen betyder.
 */
export function computeFeeLine(rule: FeeRuleInput | null, input: FeeLineInput): FeeComputation {
  const { durationMinutes, prepMinutes, registeredStatus, meetingStatus } = input;
  for (const minutes of [durationMinutes, prepMinutes]) {
    if (!Number.isInteger(minutes) || minutes < 0) {
      throw new Error(`Ugyldigt honorargrundlag: ${durationMinutes} + ${prepMinutes} min.`);
    }
  }
  const basisMinutes = durationMinutes + prepMinutes;

  if (meetingStatus === "aflyst") return { kind: "aflyst" };
  if (registeredStatus === null) return { kind: "ikke_registreret" };
  if (rule === null) return { kind: "ingen_sats" };

  const beregnet = (amountMinor: number): FeeComputation => ({
    kind: "beregnet",
    amountMinor,
    currency: rule.currency,
    basisMinutes,
    basis: registeredStatus,
    vatMode: rule.vatMode,
    ruleVersion: rule.version,
  });

  if (registeredStatus === "afholdt") {
    return beregnet(feeAmountMinor(rule.hourlyRateMinor, basisMinutes));
  }

  // forsinket_afbud / udeblivelse: konsekvensen er ejerens beslutning (§12 pkt. 13).
  switch (rule.absenceRule) {
    case "intet_honorar":
      return beregnet(0);
    case "fuldt_honorar":
      return beregnet(feeAmountMinor(rule.hourlyRateMinor, basisMinutes));
    case "ikke_fastlagt":
      return {
        kind: "afventer_regel",
        basis: registeredStatus,
        basisMinutes,
        ruleVersion: rule.version,
      };
  }
}

export interface FeeTotals {
  /** Sum af beregnede beløb pr. valuta (aldrig blandet på tværs af valutaer). */
  totalsByCurrency: Array<{ currency: string; amountMinor: number }>;
  /** Antal linjer med et beregnet beløb på grundlag af 'afholdt'. */
  heldCount: number;
  /** Beregnede linjer i alt (inkl. afbud/udeblivelse afgjort af reglen). */
  calculatedCount: number;
  /** Linjer hvor grundlaget er registreret, men reglen for afbud/udeblivelse mangler. */
  awaitingRuleCount: number;
  /** Linjer uden sats for mødetidspunktet. */
  noRateCount: number;
  /** Linjer partneren endnu ikke har registreret. */
  notRegisteredCount: number;
  /** Aflyste møder (intet grundlag). */
  cancelledCount: number;
  /** Momsbehandlinger blandt de beregnede linjer — flere end én betyder at reglen skiftede i perioden. */
  vatModes: FeeVatMode[];
}

/** Opsummér beregnede linjer til de tal en opgørelse viser først. Ren. */
export function summarizeFees(results: readonly FeeComputation[]): FeeTotals {
  const byCurrency = new Map<string, number>();
  const vat = new Set<FeeVatMode>();
  const totals: FeeTotals = {
    totalsByCurrency: [],
    heldCount: 0,
    calculatedCount: 0,
    awaitingRuleCount: 0,
    noRateCount: 0,
    notRegisteredCount: 0,
    cancelledCount: 0,
    vatModes: [],
  };

  for (const result of results) {
    switch (result.kind) {
      case "beregnet":
        byCurrency.set(result.currency, (byCurrency.get(result.currency) ?? 0) + result.amountMinor);
        vat.add(result.vatMode);
        totals.calculatedCount += 1;
        if (result.basis === "afholdt") totals.heldCount += 1;
        break;
      case "afventer_regel":
        totals.awaitingRuleCount += 1;
        break;
      case "ingen_sats":
        totals.noRateCount += 1;
        break;
      case "ikke_registreret":
        totals.notRegisteredCount += 1;
        break;
      case "aflyst":
        totals.cancelledCount += 1;
        break;
    }
  }

  totals.totalsByCurrency = [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amountMinor]) => ({ currency, amountMinor }));
  totals.vatModes = [...vat].sort();
  return totals;
}

export const VAT_MODE_LABEL: Record<FeeVatMode, string> = {
  ikke_fastlagt: "Moms ikke fastlagt",
  ekskl_moms: "Ekskl. moms",
  inkl_moms: "Inkl. moms",
};

export const ABSENCE_RULE_LABEL: Record<FeeAbsenceRule, string> = {
  ikke_fastlagt: "Ikke fastlagt",
  intet_honorar: "Intet honorar",
  fuldt_honorar: "Fuldt honorar",
};

export const REGISTERED_STATUS_LABEL: Record<FeeRegisteredStatus, string> = {
  afholdt: "Afholdt",
  forsinket_afbud: "Forsinket afbud",
  udeblivelse: "Udeblivelse",
};

/** Kort, ærlig tekst for hvorfor en linje ikke har et beløb (eller hvad beløbet bygger på). */
export function describeFee(result: FeeComputation): string {
  switch (result.kind) {
    case "beregnet":
      return result.basis === "afholdt"
        ? "Beregnet"
        : `Beregnet efter afbudsregel (${REGISTERED_STATUS_LABEL[result.basis].toLowerCase()})`;
    case "afventer_regel":
      return `${REGISTERED_STATUS_LABEL[result.basis]} — afventer regel for afbud og udeblivelse`;
    case "ingen_sats":
      return "Ingen honorarsats gælder for mødetidspunktet";
    case "ikke_registreret":
      return "Mødet er ikke registreret endnu";
    case "aflyst":
      return "Aflyst — intet grundlag";
  }
}
