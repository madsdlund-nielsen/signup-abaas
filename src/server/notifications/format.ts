/**
 * Formatering af værdier der flettes ind i beskeder. Ren (kun Intl).
 */

const TIME_ZONE = "Europe/Copenhagen";

/**
 * Et tidspunkt som danskerne læser det: «tirsdag den 13. oktober 2026 kl. 10.00», altid i dansk
 * tid — Netlify kører i UTC, og et mødetidspunkt der står 2 timer forkert i en påmindelse er
 * værre end ingen påmindelse (jf. B-29).
 */
export function formatMeetingTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Ugyldigt tidspunkt '${iso}'.`);
  const day = new Intl.DateTimeFormat("da-DK", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("da-DK", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(":", ".");
  return `${day} kl. ${time}`;
}

/** Absolut adresse til en side i platformen, eller `undefined` hvis appens URL ikke er sat. */
export function appLink(path: string, appUrl: string | undefined | null): string | undefined {
  if (!appUrl) return undefined;
  return `${appUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
