/**
 * Ugedage og tidsformat til visning (fase 5.3). Ligger for sig, så både skærmen og
 * komponenterne kan bruge dem uden at trække server-kode med.
 */

/** ISO-ugedage: 1 = mandag … 7 = søndag. */
export const WEEKDAYS = [
  { iso: 1, label: "Mandag", short: "Man" },
  { iso: 2, label: "Tirsdag", short: "Tir" },
  { iso: 3, label: "Onsdag", short: "Ons" },
  { iso: 4, label: "Torsdag", short: "Tor" },
  { iso: 5, label: "Fredag", short: "Fre" },
  { iso: 6, label: "Lørdag", short: "Lør" },
  { iso: 7, label: "Søndag", short: "Søn" },
] as const;

/** "09:00:00" (Postgres `time`) → "09:00". */
export function formatTime(time: string): string {
  return time.slice(0, 5);
}
