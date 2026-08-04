import { computeMeetingFee, formatMinor } from "@/server/pricing/algorithm";
import type { FrequencyWeeks, PricingRuleInput } from "@/server/pricing/algorithm";

/**
 * Det brudte prisregnestykke (Fase 3, ADR 0028) — DELT mellem admin-preview og ejer-flowet,
 * så admin ser præcis det kunden ser (samme princip som QuizRenderer i preview, ADR 0017).
 * Ren props-komponent; beregningen er `computeMeetingFee` (samme funktion begge steder).
 */
export function PriceBreakdown({
  rule,
  partnerCount,
  frequencyWeeks,
}: {
  rule: PricingRuleInput;
  partnerCount: number;
  frequencyWeeks: FrequencyWeeks;
}) {
  const fee = computeMeetingFee(rule, partnerCount, frequencyWeeks);
  const b = fee.breakdown;

  return (
    <table className="table">
      <tbody>
        <tr className="table__row">
          <td className="table__cell">Grundpris pr. møde</td>
          <td className="table__cell">{formatMinor(b.baseAmountMinor, fee.currency)}</td>
        </tr>
        <tr className="table__row">
          <td className="table__cell">
            {b.partnerCount} partnere × {formatMinor(b.perPartnerAmountMinor, fee.currency)}
          </td>
          <td className="table__cell">{formatMinor(b.partnersAmountMinor, fee.currency)}</td>
        </tr>
        <tr className="table__row">
          <td className="table__cell">Frekvensfaktor (hver {b.frequencyWeeks}. uge)</td>
          <td className="table__cell">× {b.factor}</td>
        </tr>
        <tr className="table__row">
          <td className="table__cell">
            <strong>Meeting-fee pr. afholdt møde</strong>
          </td>
          <td className="table__cell">
            <strong>{formatMinor(fee.amountMinor, fee.currency)}</strong>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
