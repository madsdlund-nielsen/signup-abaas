/**
 * Opret opkrævningsgrundlag ved afholdelse (Fase 3, ADR 0028). Kaldes fra afholdelses-
 * flippet i registerMeetingStatus — KUN af den registrering der faktisk flippede
 * planlagt→afholdt (idempotenslag 1); `payment_charge.meeting_id unique` er lag 2.
 *
 * Beløbet beregnes af den AKTIVE prisregel × boardstørrelse × membership-frekvens PÅ
 * AFHOLDELSESTIDSPUNKTET (§5.9: ændringer slår igennem ved næste afholdelse; ingen
 * proratering). pricing_rule_id gemmes som audit af hvilken version der blev anvendt.
 *
 * Mangler membership eller aktiv prisregel, oprettes INGEN række — fejlen logges via
 * analytics, og hullet er synligt ved læsning (afholdt møde uden charge). Intet gættet
 * beløb (stub-politik). Partner-registreringens UX afhænger aldrig af dette: fejl her
 * kaster ikke ud til partneren.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdapters } from "@/lib";
import { computeMeetingFee, type FrequencyWeeks, type PricingRuleInput } from "@/server/pricing/algorithm";

interface RuleRow {
  id: string;
  version: number;
  base_amount_minor: number;
  per_partner_amount_minor: number;
  factor_4_weeks: string | number;
  factor_8_weeks: string | number;
  factor_12_weeks: string | number;
  currency: string;
}

async function logSkip(meetingId: string, reason: string): Promise<void> {
  await getAdapters().analytics.captureException(new Error(`charge-grundlag sprunget over: ${reason}`), {
    source: "charge-ved-afholdelse",
    meetingId,
  });
}

/** Opret charge-grundlaget for et netop afholdt møde. Kaster aldrig — logger og returnerer. */
export async function createChargeForMeeting(
  service: SupabaseClient,
  meetingId: string,
): Promise<void> {
  const { data: meeting } = await service
    .from("meeting")
    .select("board_id")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return logSkip(meetingId, "mødet findes ikke");
  const boardId = (meeting as { board_id: string }).board_id;

  const { data: membership } = await service
    .from("membership")
    .select("id, frequency_weeks")
    .eq("board_id", boardId)
    .maybeSingle();
  if (!membership) return logSkip(meetingId, "intet membership for boardet");

  const { data: rule } = await service
    .from("pricing_rule")
    .select(
      "id, version, base_amount_minor, per_partner_amount_minor, factor_4_weeks, factor_8_weeks, factor_12_weeks, currency",
    )
    .eq("is_active", true)
    .maybeSingle();
  if (!rule) return logSkip(meetingId, "ingen aktiv prisregel (startpris er ikke fastsat)");

  const { count } = await service
    .from("board_partner")
    .select("partner_id", { count: "exact", head: true })
    .eq("board_id", boardId);
  const partnerCount = count ?? 0;
  if (partnerCount < 1) return logSkip(meetingId, "boardet har ingen partnere");

  const ruleRow = rule as unknown as RuleRow;
  const pricingRule: PricingRuleInput = {
    id: ruleRow.id,
    version: ruleRow.version,
    baseAmountMinor: ruleRow.base_amount_minor,
    perPartnerAmountMinor: ruleRow.per_partner_amount_minor,
    factor4Weeks: Number(ruleRow.factor_4_weeks),
    factor8Weeks: Number(ruleRow.factor_8_weeks),
    factor12Weeks: Number(ruleRow.factor_12_weeks),
    currency: ruleRow.currency,
  };

  let fee;
  try {
    fee = computeMeetingFee(
      pricingRule,
      partnerCount,
      (membership as { frequency_weeks: number }).frequency_weeks as FrequencyWeeks,
    );
  } catch (e) {
    return logSkip(meetingId, e instanceof Error ? e.message : String(e));
  }

  const { error } = await service.from("payment_charge").insert({
    meeting_id: meetingId,
    membership_id: (membership as { id: string }).id,
    pricing_rule_id: fee.pricingRuleId,
    amount_minor: fee.amountMinor,
    currency: fee.currency,
  });
  if (error) {
    // 23505 = allerede oprettet (idempotenslag 2) — stille ok; alt andet logges.
    if (error.code !== "23505") await logSkip(meetingId, `insert fejlede: ${error.message}`);
  }
}
