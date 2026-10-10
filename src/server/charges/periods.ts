/**
 * Faktureringsperioder for abonnementet (B-19, ADR 0034 + 0056). Ren funktion — ingen
 * Supabase-, env- eller React-afhængigheder, så kadencen kan enhedstestes uden DB.
 *
 * Abonnementet forfalder hver 4. uge = 28 dage, regnet fra medlemskabets `billing_anchor`
 * (datoen kortet blev registreret). Alt regnes i RENE KALENDERDATOER ("YYYY-MM-DD", dansk
 * dato) — aldrig i tidsstempler. Dermed kan sommertid ikke forskyde en periodegrænse en
 * time hen over midnat, og Netlifys UTC-server giver samme svar som en dansk maskine.
 *
 * Perioden er halvåben: [start, end), og `end` er næste periodes start.
 *
 * Bevidst IKKE med (uafklaret, ejer): proratering ved op-/nedgradering midt i en periode og
 * opsigelsesvarsel. Ændringer slår igennem fra NÆSTE periode, og opsigelsesdatoen afskærer
 * kun nye perioder.
 * TODO(ejer): proratering + opsigelsesvarsel (docs/stub-register.md).
 */

/** Fast kadence (ADR 0034): hver 4. uge. Ikke en forretningssats — beslutningen er truffet. */
export const BILLING_PERIOD_DAYS = 28;

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface BillingPeriod {
  /** Første dag i perioden (inklusiv), dansk kalenderdato. */
  start: string;
  /** Næste periodes første dag (eksklusiv). */
  end: string;
}

function toDayNumber(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`Ugyldig dato '${date}' — forventer YYYY-MM-DD.`);
  const [, year, month, day] = match;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const roundTrip = new Date(ms).toISOString().slice(0, 10);
  if (roundTrip !== date) throw new Error(`Ugyldig dato '${date}' — findes ikke i kalenderen.`);
  return ms / DAY_MS;
}

function fromDayNumber(days: number): string {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

/** Læg hele dage til en kalenderdato. */
export function addDays(date: string, days: number): string {
  return fromDayNumber(toDayNumber(date) + days);
}

const COPENHAGEN_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Copenhagen",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Det danske kalenderdøgn et tidspunkt falder i ("YYYY-MM-DD"), uanset serverens zone. */
export function copenhagenDate(at: Date): string {
  return COPENHAGEN_DATE.format(at);
}

function periodAt(anchor: string, index: number): BillingPeriod {
  const startDay = toDayNumber(anchor) + index * BILLING_PERIOD_DAYS;
  return { start: fromDayNumber(startDay), end: fromDayNumber(startDay + BILLING_PERIOD_DAYS) };
}

/** Index på den periode `date` falder i; −1 hvis datoen ligger før ankeret. */
function periodIndex(anchor: string, date: string): number {
  const offset = toDayNumber(date) - toDayNumber(anchor);
  return offset < 0 ? -1 : Math.floor(offset / BILLING_PERIOD_DAYS);
}

/** Må en periode der starter på `start` overhovedet oprettes? Ikke efter opsigelsesdatoen. */
function isBillable(start: string, cancelledAt: string | null | undefined): boolean {
  return !cancelledAt || toDayNumber(start) <= toDayNumber(cancelledAt);
}

/**
 * Perioden `date` falder i. Null før ankeret (abonnementet er ikke begyndt), og null hvis
 * perioden ville starte efter opsigelsen.
 */
export function periodContaining(
  anchor: string,
  date: string,
  cancelledAt?: string | null,
): BillingPeriod | null {
  const index = periodIndex(anchor, date);
  if (index < 0) return null;
  const period = periodAt(anchor, index);
  return isBillable(period.start, cancelledAt) ? period : null;
}

/**
 * Perioden efter den `date` falder i. Før ankeret er det den første periode. Null hvis den
 * ville starte efter opsigelsen.
 */
export function nextPeriod(
  anchor: string,
  date: string,
  cancelledAt?: string | null,
): BillingPeriod | null {
  const period = periodAt(anchor, periodIndex(anchor, date) + 1);
  return isBillable(period.start, cancelledAt) ? period : null;
}

export interface CurrentAndNextPeriod {
  current: BillingPeriod | null;
  next: BillingPeriod | null;
}

/** Indeværende og næste periode ud fra et tidspunkt (default nu; omregnet til dansk dato). */
export function currentAndNextPeriod(
  anchor: string,
  cancelledAt?: string | null,
  now: Date = new Date(),
): CurrentAndNextPeriod {
  const today = copenhagenDate(now);
  return {
    current: periodContaining(anchor, today, cancelledAt),
    next: nextPeriod(anchor, today, cancelledAt),
  };
}

/** "YYYY-MM-DD" som læsbar dansk dato ("4. november 2026"). Rent kalenderregnet — ingen zone. */
export function formatCalendarDate(date: string): string {
  toDayNumber(date); // valider
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("da-DK", { dateStyle: "long", timeZone: "UTC" });
}

/** Sidste dag i en halvåben periode (end − 1 dag) — til visning som "fra … til og med …". */
export function lastDayOf(period: BillingPeriod): string {
  return addDays(period.end, -1);
}
