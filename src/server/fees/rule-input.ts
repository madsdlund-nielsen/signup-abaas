/**
 * Validering af en ny honorarregel-version (Fase 5.1, ADR 0051). Ren: formularens rå felter ind,
 * et typet resultat eller en dansk fejltekst ud. Ingen værdi har en default — satsen, momsmåden
 * og afbudsreglen kommer alle fra admins indtastning (stub-politik).
 */

import type { FeeAbsenceRule, FeeVatMode } from "./algorithm";
import { copenhagenLocalToIso } from "./period";

export interface NewFeeRule {
  hourlyRateMinor: number;
  vatMode: FeeVatMode;
  absenceRule: FeeAbsenceRule;
  /** UTC ISO. */
  effectiveFrom: string;
}

export interface RawFeeRuleInput {
  hourlyRate: string;
  vatMode: string;
  absenceRule: string;
  /** "ÅÅÅÅ-MM-DDTTT:MM" fra et datetime-local-felt, fortolket som dansk tid. */
  effectiveFrom: string;
}

const VAT_MODES: readonly FeeVatMode[] = ["ikke_fastlagt", "ekskl_moms", "inkl_moms"];
const ABSENCE_RULES: readonly FeeAbsenceRule[] = ["ikke_fastlagt", "intet_honorar", "fuldt_honorar"];

export type ParsedFeeRule = { ok: true; value: NewFeeRule } | { ok: false; error: string };

/**
 * @param latestEffectiveFrom  Gyldighedstidspunktet på den nyeste eksisterende version (null hvis
 *   der ingen er). En ny version må hverken ligge før den eller i fortiden: begge dele ville ændre
 *   hvordan allerede afviklede møder afregnes og dermed en opgørelse der kan være sendt videre.
 *   Den allerførste version er undtaget — der er intet at ændre retroaktivt, og den skal kunne
 *   dække møder der allerede er afholdt.
 */
export function parseNewFeeRule(
  raw: RawFeeRuleInput,
  latestEffectiveFrom: string | null,
  now: Date = new Date(),
): ParsedFeeRule {
  const rate = Number(raw.hourlyRate);
  if (raw.hourlyRate.trim() === "" || !Number.isInteger(rate) || rate < 0) {
    return { ok: false, error: "Ugyldig sats — angiv hele øre pr. time (heltal ≥ 0)." };
  }

  const vatMode = VAT_MODES.find((mode) => mode === raw.vatMode);
  if (!vatMode) return { ok: false, error: "Vælg en momsbehandling (også 'ikke fastlagt')." };

  const absenceRule = ABSENCE_RULES.find((rule) => rule === raw.absenceRule);
  if (!absenceRule) return { ok: false, error: "Vælg en afbudsregel (også 'ikke fastlagt')." };

  let effectiveFrom: string;
  try {
    effectiveFrom = copenhagenLocalToIso(raw.effectiveFrom);
  } catch {
    return { ok: false, error: "Ugyldigt gyldighedstidspunkt." };
  }

  if (latestEffectiveFrom !== null) {
    if (new Date(effectiveFrom).getTime() <= new Date(latestEffectiveFrom).getTime()) {
      return {
        ok: false,
        error:
          "Gyldighedstidspunktet skal ligge efter den nuværende nyeste versions — ellers ville en eksisterende version blive overskygget og historikken ændret.",
      };
    }
    if (new Date(effectiveFrom).getTime() < now.getTime()) {
      return {
        ok: false,
        error:
          "Gyldighedstidspunktet må ikke ligge i fortiden — en ny version gælder fremadrettet og ændrer aldrig en opgørelse for møder der allerede er afviklet.",
      };
    }
  }

  return { ok: true, value: { hourlyRateMinor: rate, vatMode, absenceRule, effectiveFrom } };
}
