/**
 * Opret opkrævningsgrundlag pr. faktureringsperiode (B-19, ADR 0034 + 0056). Erstatter
 * charge-ved-afholdelse (ADR 0030): opkrævningen er koblet fra møderne og forfalder i fast
 * kadence — hver 4. uge — uanset om der blev afholdt et møde i perioden.
 *
 * Kaldes af den planlagte kørsel (`/api/cron/charge-periods`) med service-role-klienten.
 * For hvert medlemskab med registreret kort oprettes opkrævningen for den periode i dag
 * falder i. Idempotent: `payment_charge (membership_id, period_start)` er unique, så en
 * gentagen eller overlappende kørsel giver 23505 → "fandtes allerede", aldrig en dublet.
 *
 * Beløbet er den AKTIVE prisregel × boardets rådgiverantal × medlemskabets frekvens PÅ
 * PERIODENS START (formlen er uændret, ADR 0030). `pricing_rule_id`, `partner_count` og
 * `frequency_weeks` gemmes som audit. Op-/nedgradering midt i en periode rører ikke den
 * allerede oprettede opkrævning — ændringen slår igennem ved næste periode (ingen proratering).
 *
 * Mangler aktiv prisregel, oprettes INGEN række — fejlen logges via analytics, og hullet er
 * synligt (intet gættet beløb, stub-politik). Perioder der er sprunget helt over (kørslen lå
 * stille i ≥ 28 dage) efterfaktureres ALDRIG automatisk: kun indeværende periode oprettes.
 * TODO(ejer): efterfakturering af oversprungne perioder er en forretningsbeslutning.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdapters } from "@/lib";
import { computeMeetingFee, type FrequencyWeeks, type PricingRuleInput } from "@/server/pricing/algorithm";

import { copenhagenDate, periodContaining } from "./periods";

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

interface MembershipRow {
  id: string;
  board_id: string;
  frequency_weeks: number;
  status: "aktiv" | "opsagt";
  billing_anchor: string | null;
  cancelled_at: string | null;
}

export interface DuePeriodsResult {
  /** Nye opkrævninger oprettet i denne kørsel. */
  created: number;
  /** Perioder der allerede havde en opkrævning (idempotens). */
  alreadyExisted: number;
  /** Medlemskaber der blev sprunget over, med årsag (synligt hul — intet gættes). */
  skipped: Array<{ membershipId: string; reason: string }>;
  /** Sat når der slet ingen aktiv prisregel var — så kører intet. */
  noActiveRule: boolean;
}

const RULE_COLUMNS =
  "id, version, base_amount_minor, per_partner_amount_minor, factor_4_weeks, factor_8_weeks, factor_12_weeks, currency";

async function logSkip(scope: string, reason: string): Promise<void> {
  await getAdapters().analytics.captureException(new Error(`periode-opkrævning sprunget over: ${reason}`), {
    source: "opkraev-pr-periode",
    scope,
  });
}

function toPricingRule(row: RuleRow): PricingRuleInput {
  return {
    id: row.id,
    version: row.version,
    baseAmountMinor: row.base_amount_minor,
    perPartnerAmountMinor: row.per_partner_amount_minor,
    factor4Weeks: Number(row.factor_4_weeks),
    factor8Weeks: Number(row.factor_8_weeks),
    factor12Weeks: Number(row.factor_12_weeks),
    currency: row.currency,
  };
}

/**
 * Opret manglende periode-opkrævninger for alle aktive medlemskaber med registreret kort.
 * Kaster ikke på forretningsmæssige huller (logger og returnerer dem i `skipped`); kaster
 * kun hvis grundlæggende læsninger fejler, så kørslen fejler højlydt frem for at tie.
 */
export async function createChargesForDuePeriods(
  service: SupabaseClient,
  now: Date = new Date(),
): Promise<DuePeriodsResult> {
  const result: DuePeriodsResult = { created: 0, alreadyExisted: 0, skipped: [], noActiveRule: false };
  const today = copenhagenDate(now);

  const { data: rule, error: ruleError } = await service
    .from("pricing_rule")
    .select(RULE_COLUMNS)
    .eq("is_active", true)
    .maybeSingle();
  if (ruleError) throw new Error(`Kunne ikke læse prisreglen: ${ruleError.message}`);
  if (!rule) {
    result.noActiveRule = true;
    await logSkip("*", "ingen aktiv prisregel (startpris er ikke fastsat)");
    return result;
  }
  const pricingRule = toPricingRule(rule as unknown as RuleRow);

  const { data: memberships, error: membershipError } = await service
    .from("membership")
    .select("id, board_id, frequency_weeks, status, billing_anchor, cancelled_at")
    .eq("card_status", "registreret")
    .not("billing_anchor", "is", null);
  if (membershipError) throw new Error(`Kunne ikke læse medlemskaber: ${membershipError.message}`);

  // Aktive medlemskaber, og opsagte der har en opsigelsesdato (perioder op til den skal stadig
  // kunne hentes ind). Opsagt uden dato afskærer alt — vi ved ikke fra hvornår.
  const eligible = ((memberships ?? []) as unknown as MembershipRow[]).filter(
    (m) => m.billing_anchor && (m.status === "aktiv" || m.cancelled_at),
  );
  if (eligible.length === 0) return result;

  const boardIds = [...new Set(eligible.map((m) => m.board_id))];
  const { data: seats, error: seatsError } = await service
    .from("board_partner")
    .select("board_id")
    .in("board_id", boardIds);
  if (seatsError) throw new Error(`Kunne ikke læse boardsammensætning: ${seatsError.message}`);
  const partnerCounts = new Map<string, number>();
  for (const seat of (seats ?? []) as Array<{ board_id: string }>) {
    partnerCounts.set(seat.board_id, (partnerCounts.get(seat.board_id) ?? 0) + 1);
  }

  for (const membership of eligible) {
    const period = periodContaining(membership.billing_anchor as string, today, membership.cancelled_at);
    if (!period) continue; // før ankeret, eller opsagt — ingen ny periode, og det er ikke en fejl.

    const partnerCount = partnerCounts.get(membership.board_id) ?? 0;
    if (partnerCount < 1) {
      result.skipped.push({ membershipId: membership.id, reason: "boardet har ingen partnere" });
      await logSkip(membership.id, "boardet har ingen partnere");
      continue;
    }

    let fee;
    try {
      fee = computeMeetingFee(pricingRule, partnerCount, membership.frequency_weeks as FrequencyWeeks);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      result.skipped.push({ membershipId: membership.id, reason });
      await logSkip(membership.id, reason);
      continue;
    }

    const { error } = await service.from("payment_charge").insert({
      membership_id: membership.id,
      pricing_rule_id: fee.pricingRuleId,
      amount_minor: fee.amountMinor,
      currency: fee.currency,
      period_start: period.start,
      period_end: period.end,
      frequency_weeks: membership.frequency_weeks,
      partner_count: partnerCount,
    });
    if (!error) {
      result.created += 1;
    } else if (error.code === "23505") {
      // Idempotens: perioden har allerede sin opkrævning — stille ok.
      result.alreadyExisted += 1;
    } else {
      result.skipped.push({ membershipId: membership.id, reason: `insert fejlede: ${error.message}` });
      await logSkip(membership.id, `insert fejlede: ${error.message}`);
    }
  }

  return result;
}
