/**
 * Partner-tilgængelighed — ren logik (fase 5.3, ADR 0052). Ingen DB, ingen I/O: input er de
 * rækker `partner_availability`/`partner_absence` (0018) er skrevet som, så reglerne kan
 * enhedstestes uden Supabase.
 *
 * TIDSZONE. Ugevinduer ("mandag 09:00-12:00") og fravær ("12.-14. oktober") er lagret som LOKAL
 * VÆGURSTID i Europe/Copenhagen. Et møde er et absolut tidspunkt (UTC). Hele modulets opgave
 * er at oversætte mellem de to korrekt — også ved sommertidsskift:
 *   - Forårsskiftet (kl. 02:00 → 03:00) har en time der ikke findes. En vægurstid i hullet
 *     rykkes frem med hullets længde (02:30 → 03:30, som JS/Temporal "compatible"); et vindue
 *     02:00-04:00 er derfor kun én reel time (03:00-04:00).
 *   - Efterårsskiftet (kl. 03:00 → 02:00) har en time der findes to gange. Et vindue der
 *     omfatter den (02:00-03:00) dækker begge forekomster, dvs. to reelle timer. Starten
 *     vælges som den tidligste og slutningen som den seneste forekomst.
 * Intet dato-bibliotek: Intl.DateTimeFormat kender Copenhagens regler, og hele oversættelsen
 * er under 40 linjer.
 *
 * "IKKE ANGIVET". En partner uden ugevinduer har ikke begrænset sin tilgængelighed, og
 * behandles som ubegrænset — ellers kunne ingen booke et board før samtlige partnere havde
 * udfyldt skemaet. FRAVÆR gælder uanset: det er eksplicit information.
 * TODO(ejer): skal "ikke angivet" betyde "ikke bookbar" i stedet? Registreret som
 * beslutnings-pladsholder i docs/stub-register.md. Reglen står KUN her (`isRestricted`).
 */

export const TIME_ZONE = "Europe/Copenhagen";

/** Ugentligt fast vindue. `weekday` er ISO (1 = mandag … 7 = søndag); tider er "HH:MM[:SS]". */
export interface AvailabilitySlot {
  weekday: number;
  startTime: string;
  endTime: string;
}

/** Fraværsperiode i hele dage, begge ender inklusive ("YYYY-MM-DD", lokal dato). */
export interface AbsencePeriod {
  startsOn: string;
  endsOn: string;
}

export interface PartnerCalendar {
  slots: AvailabilitySlot[];
  absences: AbsencePeriod[];
}

export interface TimeWindow {
  start: Date;
  end: Date;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** [start, slut) i epoch-millisekunder. */
type Interval = readonly [number, number];

// --- Tidszone-oversættelse ------------------------------------------------------------

const zoneFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** Copenhagens UTC-forskydning (ms) på et givet absolut tidspunkt: 1 time vinter, 2 sommer. */
function offsetMs(instant: number): number {
  const parts = zoneFormat.formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour") % 24,
    part("minute"),
    part("second"),
  );
  return asIfUtc - Math.floor(instant / 1000) * 1000;
}

/** Lokal dato ("YYYY-MM-DD") på et absolut tidspunkt. */
function localDateOf(instant: number): string {
  return new Date(instant + offsetMs(instant)).toISOString().slice(0, 10);
}

function parseDate(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`Ugyldig dato: "${date}" (forventer YYYY-MM-DD)`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(date: string, days: number): string {
  return new Date(parseDate(date) + days * DAY).toISOString().slice(0, 10);
}

/** ISO-ugedag for en kalenderdato: 1 = mandag … 7 = søndag. */
function isoWeekday(date: string): number {
  const day = new Date(parseDate(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** "HH:MM[:SS]" → minutter efter midnat. "24:00" er gyldig og betyder midnat. */
function parseMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!match) throw new RangeError(`Ugyldigt klokkeslæt: "${time}" (forventer HH:MM)`);
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes > 24 * 60 || Number(match[2]) > 59) {
    throw new RangeError(`Ugyldigt klokkeslæt: "${time}"`);
  }
  return minutes;
}

/**
 * Lokal vægurstid → absolut tidspunkt. Kun ved sommertidsskift er svaret ikke entydigt:
 * i hullet (forår) rykkes tiden frem, og i den dobbelte time (efterår) vælges den tidligste
 * eller seneste forekomst efter `pick`.
 */
function wallToInstant(date: string, minutes: number, pick: "earliest" | "latest"): number {
  const guess = parseDate(date) + minutes * MINUTE;
  const before = offsetMs(guess - DAY);
  const after = offsetMs(guess + DAY);
  const valid = [...new Set([before, after])]
    .map((offset) => guess - offset)
    .filter((candidate) => offsetMs(candidate) === guess - candidate);
  if (valid.length === 0) return guess - before; // hul: frem med hullets længde
  return pick === "earliest" ? Math.min(...valid) : Math.max(...valid);
}

// --- Intervalregning ------------------------------------------------------------------

function merge(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  for (let x = a[i], y = b[j]; x && y; x = a[i], y = b[j]) {
    const start = Math.max(x[0], y[0]);
    const end = Math.min(x[1], y[1]);
    if (end > start) out.push([start, end]);
    if (x[1] < y[1]) i += 1;
    else j += 1;
  }
  return out;
}

function subtract(from: Interval[], minus: Interval[]): Interval[] {
  let rest = from;
  for (const [cutStart, cutEnd] of minus) {
    const next: Interval[] = [];
    for (const [start, end] of rest) {
      if (cutEnd <= start || cutStart >= end) {
        next.push([start, end]);
        continue;
      }
      if (cutStart > start) next.push([start, cutStart]);
      if (cutEnd < end) next.push([cutEnd, end]);
    }
    rest = next;
  }
  return rest;
}

// --- Fra rækker til intervaller -------------------------------------------------------

/** Ugevinduerne udfoldet til absolutte intervaller på hver lokal dato i [fromDate, toDate]. */
function slotIntervals(slots: AvailabilitySlot[], fromDate: string, toDate: string): Interval[] {
  const out: Interval[] = [];
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    const weekday = isoWeekday(date);
    for (const slot of slots) {
      if (slot.weekday !== weekday) continue;
      out.push([
        wallToInstant(date, parseMinutes(slot.startTime), "earliest"),
        wallToInstant(date, parseMinutes(slot.endTime), "latest"),
      ]);
    }
  }
  return merge(out);
}

/** Fraværet som absolutte intervaller: fra første dags midnat til dagen EFTER sidste dag. */
function absenceIntervals(absences: AbsencePeriod[]): Interval[] {
  return merge(
    absences.map((a): Interval => [
      wallToInstant(a.startsOn, 0, "earliest"),
      wallToInstant(addDays(a.endsOn, 1), 0, "earliest"),
    ]),
  );
}

/** Det ene sted "ikke angivet = ingen begrænsning" bor (TODO(ejer), se filhovedet). */
function isRestricted(slots: AvailabilitySlot[]): boolean {
  return slots.length > 0;
}

// --- Offentligt API -------------------------------------------------------------------

/**
 * Er partneren ledig i HELE tidsrummet [startsAt, startsAt + durationMinutes)?
 * Grænsetilfælde: et møde der starter præcis ved vinduets start og slutter præcis ved dets
 * slutning er ledigt; ét minut udenfor er ikke. Et møde kan dækkes af to sammenhængende
 * vinduer (09-12 + 12-15 dækker 11-13). Fravær på én lokal dag af mødet afviser det.
 */
export function isPartnerAvailable(
  slots: AvailabilitySlot[],
  absences: AbsencePeriod[],
  startsAt: Date,
  durationMinutes: number,
): boolean {
  const start = startsAt.getTime();
  if (Number.isNaN(start)) throw new RangeError("Ugyldigt starttidspunkt.");
  if (!(durationMinutes > 0)) throw new RangeError("Mødelængden skal være positiv.");
  const end = start + durationMinutes * MINUTE;

  const blocked = absenceIntervals(absences);
  if (intersect(blocked, [[start, end]]).length > 0) return false;

  if (!isRestricted(slots)) return true;

  const covering = slotIntervals(slots, localDateOf(start), localDateOf(end - 1));
  return covering.some(([from, to]) => from <= start && to >= end);
}

/** De partnere der IKKE er ledige i tidsrummet — tom liste = alle er ledige. */
export function findUnavailable<T extends { calendar: PartnerCalendar }>(
  partners: T[],
  startsAt: Date,
  durationMinutes: number,
): T[] {
  return partners.filter(
    (p) => !isPartnerAvailable(p.calendar.slots, p.calendar.absences, startsAt, durationMinutes),
  );
}

export interface CommonWindowOptions {
  /** Første lokale dato ("YYYY-MM-DD") i perioden. */
  startDate: string;
  /** Antal døgn fra og med `startDate`. Default 7. */
  days?: number;
  /** Korteste vindue der er værd at vise, i minutter. Default 0 (alle). */
  minimumMinutes?: number;
  /** Intet før dette tidspunkt (typisk "nu"), så perioden ikke tilbyder fortiden. */
  notBefore?: Date;
}

export interface CommonWindows {
  windows: TimeWindow[];
  /**
   * Falsk hvis ingen af partnerne har begrænset sig (ingen ugevinduer, intet fravær i
   * perioden). Så er `windows` blot hele perioden, og kalderen bør sige "ingen begrænsning"
   * frem for at liste døgn efter døgn.
   */
  anyRestriction: boolean;
}

/**
 * Fælles ledige vinduer for en liste partnere i en periode (normalt en uge): fællesmængden
 * af hver partners ledige tid. Ubegrænsede partnere bidrager med hele perioden.
 */
export function findCommonWindows(
  partners: PartnerCalendar[],
  options: CommonWindowOptions,
): CommonWindows {
  const days = options.days ?? 7;
  const lastDate = addDays(options.startDate, days - 1);
  const rangeStart = Math.max(
    wallToInstant(options.startDate, 0, "earliest"),
    options.notBefore?.getTime() ?? -Infinity,
  );
  const rangeEnd = wallToInstant(addDays(options.startDate, days), 0, "earliest");
  const range: Interval[] = rangeEnd > rangeStart ? [[rangeStart, rangeEnd]] : [];

  let common = range;
  let anyRestriction = false;
  for (const partner of partners) {
    let free: Interval[] = isRestricted(partner.slots)
      ? intersect(slotIntervals(partner.slots, options.startDate, lastDate), range)
      : range;
    free = subtract(free, absenceIntervals(partner.absences));
    if (JSON.stringify(free) !== JSON.stringify(range)) anyRestriction = true;
    common = intersect(common, free);
  }

  const minimum = (options.minimumMinutes ?? 0) * MINUTE;
  return {
    windows: common
      .filter(([start, end]) => end - start >= minimum)
      .map(([start, end]) => ({ start: new Date(start), end: new Date(end) })),
    anyRestriction,
  };
}

/** Lokal dato ("YYYY-MM-DD") for et tidspunkt — til kaldere der skal vælge `startDate`. */
export function copenhagenDateOf(instant: Date): string {
  return localDateOf(instant.getTime());
}
