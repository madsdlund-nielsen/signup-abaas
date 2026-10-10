/**
 * Skrub persondata ud af fejltekster før de gemmes i udsendelseslogget eller sendes til
 * analytics (ADR 0057: ingen persondata i loggen). Leverandørers fejlsvar citerer ofte
 * modtageren ("The 'to' address anna@firma.dk is invalid"), og en fejltekst er den ene
 * strøm af fri tekst der ellers kunne bringe en adresse ind i en tabel der ikke har en kolonne
 * til den.
 *
 * Bevidst grovkornet: hellere et sted for meget udeladt end en adresse tilbage. Datoer og
 * uuid'er røres ikke (kun telefonnumre med landekode og lange taltryk fjernes).
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi;
// «+45 12 34 56 78» (plus, landekode, mellemrum) eller en sammenhængende talrække på 8+ cifre.
const PHONE = /\+\d[\d ]{6,}\d|\b\d{8,}\b/g;

export const REDACTED = "[fjernet]";

export function scrubPii(text: string, maxLength = 300): string {
  return text.replace(EMAIL, REDACTED).replace(PHONE, REDACTED).slice(0, maxLength);
}

/** Fejl → skrubbet tekst. Kun beskeden — aldrig stack eller egenskaber, der kan bære data. */
export function scrubError(error: unknown, maxLength = 300): string {
  return scrubPii(error instanceof Error ? error.message : String(error), maxLength);
}
