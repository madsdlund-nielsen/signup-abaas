/**
 * Opkrævningsgrundlag (Fase 3, ADR 0028). Læsning via authed klient — RLS scoper til
 * ejerens egne charges (via membership→board); partnere ser ALDRIG betalingsdata.
 * Oprettelse sker i ./create (kaldes fra afholdelses-flippet); provider-træk i ./actions.
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

export type PaymentChargeStatus = "afventer" | "gennemfoert" | "fejlet";

export interface PaymentCharge {
  id: string;
  meetingId: string;
  amountMinor: number;
  currency: string;
  status: PaymentChargeStatus;
  failureReason: string | null;
  createdAt: string;
}

interface ChargeRow {
  id: string;
  meeting_id: string;
  amount_minor: number;
  currency: string;
  status: PaymentChargeStatus;
  failure_reason: string | null;
  created_at: string;
}

const CHARGE_COLUMNS = "id, meeting_id, amount_minor, currency, status, failure_reason, created_at";

/** Den nuværende brugers opkrævninger, nyeste først (RLS: ejer/admin). */
export async function listMyCharges(
  env: Record<string, string | undefined> = process.env,
): Promise<PaymentCharge[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("payment_charge")
    .select(CHARGE_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) {
    console.error(`[charges] listMyCharges fejlede: ${error.message}`);
    return [];
  }
  return ((data ?? []) as ChargeRow[]).map((row) => ({
    id: row.id,
    meetingId: row.meeting_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    status: row.status,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  }));
}
