/**
 * Seneste sletningskvitteringer til /admin/juridisk (ADR 0068). Læsning via den AUTHEDE server-klient —
 * RLS (`erasure_receipt_select_admin`, 0028) afgør hvem der kan se dem, så service-role bruges ikke.
 * Kvitteringerne indeholder ingen persondata (pseudonymt id-hash, systemer, udfald), men de er
 * driftsdata om hvem der er slettet hvornår, så kun admin ser dem.
 *
 * En læsefejl bliver `null` (skærmen siger det), aldrig en tom liste der ligner «ingen sletninger».
 */

import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";
import type { ErasureOutcome, SystemResult } from "./execute";

export interface ErasureReceiptRow {
  id: string;
  /** De første 12 tegn af id-hash'et — nok til at genkende en genkørsel, ikke til at slå nogen op. */
  subjectRef: string;
  executedAt: string;
  outcome: ErasureOutcome;
  systems: SystemResult[];
  missing: string[];
}

export const RECEIPT_LIMIT = 10;

export function toReceiptRow(row: Record<string, unknown>): ErasureReceiptRow {
  return {
    id: String(row.id),
    subjectRef: String(row.subject_hash ?? "").slice(0, 12),
    executedAt: String(row.executed_at),
    outcome: row.outcome === "gennemfoert" ? "gennemfoert" : "delvist",
    systems: Array.isArray(row.systems) ? (row.systems as SystemResult[]) : [],
    missing: Array.isArray(row.missing) ? (row.missing as string[]) : [],
  };
}

export async function listErasureReceipts(limit = RECEIPT_LIMIT): Promise<ErasureReceiptRow[] | null> {
  requireRole(await getCurrentUser(), "admin");
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) return null;

  try {
    const supabase = await createServerSupabase(config);
    const { data, error } = await supabase
      .from("erasure_receipt")
      .select("id, subject_hash, executed_at, outcome, systems, missing")
      .order("executed_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error(`[erasure] kvitteringer ikke læst: ${error.message}`);
      return null;
    }
    return ((data ?? []) as Record<string, unknown>[]).map(toReceiptRow);
  } catch (e) {
    console.error(`[erasure] kvitteringer ikke læst: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
