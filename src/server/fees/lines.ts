/**
 * Fra rækker til honorarlinjer (Fase 5.1). Ren: tager de rækker `partner_fee_line` leverer og de
 * versioner af honorarreglen der findes, og lader `selectFeeRule` + `computeFeeLine` afgøre hver
 * linje. Ingen Supabase-afhængighed, så sammenstillingen kan enhedstestes.
 */

import {
  computeFeeLine,
  selectFeeRule,
  type FeeComputation,
  type FeeMeetingStatus,
  type FeeRegisteredStatus,
  type FeeRuleInput,
} from "./algorithm";

/** En række som viewen `partner_fee_line` (0017) leverer, oversat til camelCase. */
export interface FeeLineRow {
  meetingId: string;
  partnerProfileId: string;
  partnerName: string;
  startsAt: string;
  meetingStatus: FeeMeetingStatus;
  durationMinutes: number;
  prepMinutes: number;
  registeredStatus: FeeRegisteredStatus | null;
}

export interface FeeLine extends FeeLineRow {
  /** Den regel mødet afregnes efter, eller null hvis ingen gælder for mødetidspunktet. */
  rule: FeeRuleInput | null;
  result: FeeComputation;
}

/** Beregn alle linjer, nyeste møde først (stabilt: ved samme tidspunkt sorteres på partnernavn). */
export function buildFeeLines(
  rows: readonly FeeLineRow[],
  rules: readonly FeeRuleInput[],
): FeeLine[] {
  return rows
    .map((row): FeeLine => {
      const rule = selectFeeRule(rules, row.startsAt);
      return {
        ...row,
        rule,
        result: computeFeeLine(rule, {
          durationMinutes: row.durationMinutes,
          prepMinutes: row.prepMinutes,
          registeredStatus: row.registeredStatus,
          meetingStatus: row.meetingStatus,
        }),
      };
    })
    .sort(
      (a, b) =>
        new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime() ||
        a.partnerName.localeCompare(b.partnerName, "da"),
    );
}

/** Linjer grupperet pr. partner (admin-opgørelsen), partnere i navnerækkefølge. */
export function groupByPartner(lines: readonly FeeLine[]): Array<{
  partnerProfileId: string;
  partnerName: string;
  lines: FeeLine[];
}> {
  const groups = new Map<string, { partnerProfileId: string; partnerName: string; lines: FeeLine[] }>();
  for (const line of lines) {
    const group = groups.get(line.partnerProfileId) ?? {
      partnerProfileId: line.partnerProfileId,
      partnerName: line.partnerName,
      lines: [],
    };
    group.lines.push(line);
    groups.set(line.partnerProfileId, group);
  }
  return [...groups.values()].sort((a, b) => a.partnerName.localeCompare(b.partnerName, "da"));
}
