/**
 * CSV-skrivning til honoraropgørelsens eksport (Fase 5.2). Ren funktion. RFC 4180: kommaer,
 * CRLF, dobbelte anførselstegn. Tekstceller der starter med = + - @ (eller tab/CR) præfikses
 * med et apostrof, så et regneark ikke tolker fx et partnernavn som en formel (CSV-injektion).
 */

export type CsvCell = string | number | null | undefined;

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Tal er aldrig formler; kun tekst desinficeres.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return [header, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}
