/**
 * Opkrævningsgrundlag (Fase 3, ADR 0030, omlagt til periodeopkrævning i ADR 0056). Læsning
 * via authed klient — RLS scoper til ejerens egne charges (via membership→board); partnere
 * ser ALDRIG betalingsdata. Oprettelse sker i ./create (planlagt kørsel pr. 4-ugers periode);
 * synkronisering til leverandørens abonnement i ./sync og ./actions.
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

export type PaymentChargeStatus = "afventer" | "rapporteret" | "gennemfoert" | "fejlet";

export interface PaymentCharge {
  id: string;
  /** Gammel pr.-møde-opkrævning (før B-19); null for periodeopkrævninger. */
  meetingId: string | null;
  /** Periode [periodStart, periodEnd) som danske kalenderdatoer; null på gamle pr.-møde-rækker. */
  periodStart: string | null;
  periodEnd: string | null;
  /** Det beløbet blev beregnet ud fra på periodens start (audit); null på gamle rækker. */
  frequencyWeeks: number | null;
  partnerCount: number | null;
  amountMinor: number;
  currency: string;
  status: PaymentChargeStatus;
  failureReason: string | null;
  createdAt: string;
}

interface ChargeRow {
  id: string;
  meeting_id: string | null;
  period_start: string | null;
  period_end: string | null;
  frequency_weeks: number | null;
  partner_count: number | null;
  amount_minor: number;
  currency: string;
  status: PaymentChargeStatus;
  failure_reason: string | null;
  created_at: string;
}

const CHARGE_COLUMNS =
  "id, meeting_id, period_start, period_end, frequency_weeks, partner_count, amount_minor, currency, status, failure_reason, created_at";

/** Den nuværende brugers opkrævninger, nyeste periode først (RLS: ejer/admin). */
export async function listMyCharges(
  env: Record<string, string | undefined> = process.env,
): Promise<PaymentCharge[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("payment_charge")
    .select(CHARGE_COLUMNS)
    .order("period_start", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) {
    console.error(`[charges] listMyCharges fejlede: ${error.message}`);
    return [];
  }
  return ((data ?? []) as ChargeRow[]).map((row) => ({
    id: row.id,
    meetingId: row.meeting_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    frequencyWeeks: row.frequency_weeks,
    partnerCount: row.partner_count,
    amountMinor: row.amount_minor,
    currency: row.currency,
    status: row.status,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  }));
}
