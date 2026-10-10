/**
 * Opgørelsesperioder (Fase 5.2). En periode er en kalendermåned i dansk tid — en opgørelse der
 * klipper ved UTC-midnat ville flytte møder kl. 00:30 dansk tid til forkert måned. Ren: ingen
 * Supabase- eller React-afhængigheder.
 */

const TIME_ZONE = "Europe/Copenhagen";

export interface Period {
  /** "ÅÅÅÅ-MM". */
  month: string;
  /** Inklusiv start (ISO, UTC). */
  from: string;
  /** Eksklusiv slut (ISO, UTC). */
  to: string;
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Forskydningen til UTC (minutter) i Europe/Copenhagen på et givent tidspunkt. */
function offsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    timeZoneName: "longOffset",
  }).formatToParts(at);
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
  if (!match) throw new Error(`Uventet tidszoneforskydning: ${name}.`);
  if (!match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

/**
 * Lokal dansk dato/tid → UTC-instant. Forskydningen aflæses ved middag på samme dato: sommertids-
 * skift sker natten til en søndag (aldrig den 1. kl. 00:00), så forskydningen er den samme hele
 * dagen for månedsgrænser og for de tidspunkter admin vælger.
 */
function localToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const nominal = Date.UTC(year, month - 1, day, hour, minute);
  const offset = offsetMinutes(new Date(Date.UTC(year, month - 1, day, 12, 0)));
  return new Date(nominal - offset * 60_000);
}

/** Gyldig "ÅÅÅÅ-MM"? */
export function isValidMonth(value: string | null | undefined): value is string {
  return typeof value === "string" && MONTH_PATTERN.test(value);
}

/** Måneden som periode i dansk tid. Kaster ved ugyldigt format. */
export function monthPeriod(month: string): Period {
  const match = MONTH_PATTERN.exec(month);
  if (!match) throw new Error(`Ugyldig måned '${month}' — forventer ÅÅÅÅ-MM.`);
  const year = Number(match[1]);
  const m = Number(match[2]);
  const nextYear = m === 12 ? year + 1 : year;
  const nextMonth = m === 12 ? 1 : m + 1;
  return {
    month,
    from: localToUtc(year, m, 1, 0, 0).toISOString(),
    to: localToUtc(nextYear, nextMonth, 1, 0, 0).toISOString(),
  };
}

/** Måneden (ÅÅÅÅ-MM, dansk tid) som et tidspunkt falder i. */
export function monthOf(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

/** Forrige/næste måned som "ÅÅÅÅ-MM". */
export function shiftMonth(month: string, delta: number): string {
  const match = MONTH_PATTERN.exec(month);
  if (!match) throw new Error(`Ugyldig måned '${month}' — forventer ÅÅÅÅ-MM.`);
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta;
  const year = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/** Periode fra en ?maaned=-parameter; ugyldig/manglende → indeværende måned. */
export function resolvePeriod(param: string | null | undefined, now: Date = new Date()): Period {
  return monthPeriod(isValidMonth(param) ? param : monthOf(now));
}

/** "Oktober 2026" til overskrifter. */
export function formatMonth(month: string): string {
  const { from } = monthPeriod(month);
  const text = new Intl.DateTimeFormat("da-DK", {
    timeZone: TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(new Date(from));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * "datetime-local"-værdi ("ÅÅÅÅ-MM-DDTTT:MM", ingen zone) → UTC ISO, fortolket som dansk tid.
 * `new Date(value)` ville bruge serverens zone (UTC på Netlify) og forskyde med 1-2 timer.
 */
export function copenhagenLocalToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Ugyldigt tidspunkt '${value}'.`);
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  // Date.UTC ruller over (31. februar → marts); en dato der ikke findes afvises i stedet.
  const nominal = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    nominal.getUTCFullYear() !== year ||
    nominal.getUTCMonth() !== month - 1 ||
    nominal.getUTCDate() !== day ||
    nominal.getUTCHours() !== hour ||
    nominal.getUTCMinutes() !== minute
  ) {
    throw new Error(`Ugyldigt tidspunkt '${value}'.`);
  }
  const date = localToUtc(year, month, day, hour, minute);
  return date.toISOString();
}
