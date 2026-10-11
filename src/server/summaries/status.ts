/**
 * Ren logik for opsummeringens livscyklus (fase 4.4, B-45, ADR 0059): statusser, låsen,
 * forsøgstælling og fejlkoder. Ingen I/O — så reglerne kan testes uden database og uden adaptere.
 *
 * Livscyklus (`meeting_summary.status`):
 *
 *   afventer ──claim──▶ genereres ──ok──▶ klar
 *       ▲                   │
 *       │                   ├─ fejl, forsøg < MAX ──▶ afventer (næste kørsel prøver igen)
 *       │                   ├─ fejl, forsøg ≥ MAX ──▶ fejlet   (ejeren trykker "Generér igen")
 *       │                   └─ samtykke/optagelse manglede ─▶ mangler_samtykke / mangler_optagelse
 *       └──────── "Generér igen" (fejlet → afventer, forsøg nulstilles)
 *
 * mangler_* tjekkes igen ved hver kørsel (samtykke eller optagelse kan komme senere) og
 * skrives kun hvis tilstanden ændrer sig.
 */

import { OrdbogenError } from "@/lib/ordbogen/client";

export const SUMMARY_STATUSES = [
  "afventer",
  "genereres",
  "klar",
  "fejlet",
  "mangler_samtykke",
  "mangler_optagelse",
] as const;
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

/**
 * Antal forsøg før rækken opgives som `fejlet`. Teknisk grænse, ikke en forretningssats: en
 * midlertidig leverandørfejl skal have lov at rette sig selv, men et møde der ikke kan
 * opsummeres må ikke koste en betalt transskription hver 15. minut for evigt.
 */
export const MAX_ATTEMPTS = 3;

/**
 * Hvor længe en `genereres`-lås gælder før en anden kørsel må overtage den. Transskription har
 * 600 s timeout og LLM 120 s (ADR 0058); 30 minutter dækker begge med luft, men frigiver en
 * række hvis funktionen døde midt i en kørsel. Overtagelsen tæller som et forsøg.
 */
export const STALE_CLAIM_MS = 30 * 60 * 1000;

/** Er en `genereres`-lås forældet, dvs. kørslen bag den er sandsynligvis død? */
export function isStaleClaim(updatedAt: string | Date, now: Date): boolean {
  return now.getTime() - new Date(updatedAt).getTime() >= STALE_CLAIM_MS;
}

/** Tilstanden efter en mislykket generering. `attempts` er antallet INKLUSIV det forsøg der fejlede. */
export function statusAfterFailure(attempts: number): "afventer" | "fejlet" {
  return attempts >= MAX_ATTEMPTS ? "fejlet" : "afventer";
}

/**
 * En kort, sikker fejlkode til `error`-kolonnen og loggen. Aldrig fejlens besked: den kan i
 * princippet bære leverandørens svartekst, og transskript/persondata må hverken gemmes eller
 * logges. Koden siger hvad der gik galt, ikke hvad mødet handlede om.
 */
export function failureCode(e: unknown): string {
  if (e instanceof OrdbogenError) {
    return `OrdbogenError:${e.operation}${e.status ? `:HTTP${e.status}` : ""}`;
  }
  if (e instanceof Error) return e.name || "Error";
  return "UkendtFejl";
}

/**
 * Hvor længe en opgivet (`fejlet`) opsummering skal ligge før ejeren kan sætte den i gang igen.
 * Teknisk bremse mod en nulstillingsløkke (hvert gennemløb kan koste MAX_ATTEMPTS betalte kald),
 * ikke en forretningsregel.
 */
export const RETRY_COOLDOWN_MS = 15 * 60 * 1000;
