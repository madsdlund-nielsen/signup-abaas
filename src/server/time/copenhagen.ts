/**
 * Dansk vægurstid ↔ UTC (B-29). Formularernes `datetime-local` har ingen zone, og
 * `new Date(value)` fortolker i SERVERENS zone — UTC på Netlify — så "10:00" blev til 10:00Z og
 * vist som 12:00 dansk tid. Alt input fra danske brugere fortolkes derfor her, som
 * Europe/Copenhagen. Ren: ingen Supabase- eller React-afhængigheder.
 */

const TIME_ZONE = "Europe/Copenhagen";

/** Forskydningen til UTC (minutter) i Europe/Copenhagen på et givent tidspunkt. */
export function copenhagenOffsetMinutes(at: Date): number {
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
 * Lokal dansk dato/tid → UTC-instant. To gennemløb: forskydningen gættes ved det nominelle
 * tidspunkt og aflæses igen ved resultatet, så tidspunkter på selve skiftedøgnet også rammer
 * rigtigt. Et tidspunkt i forårets hul (02:00-03:00) lander en time senere; et i efterårets
 * dobbelte time vælger sommertid (den første).
 */
export function copenhagenLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const nominal = Date.UTC(year, month - 1, day, hour, minute);
  const guess = copenhagenOffsetMinutes(new Date(nominal));
  const offset = copenhagenOffsetMinutes(new Date(nominal - guess * 60_000));
  return new Date(nominal - offset * 60_000);
}

/**
 * "datetime-local"-værdi ("ÅÅÅÅ-MM-DDTTT:MM", ingen zone) → UTC ISO, fortolket som dansk tid.
 * Kaster ved et format eller en dato der ikke findes (31. februar) — hellere højlydt end et
 * forskudt møde.
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
  return copenhagenLocalToUtc(year, month, day, hour, minute).toISOString();
}
