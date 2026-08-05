"use server";

/**
 * Indberetning af afventende opkrævninger til Alunta (Fase 3, ADR 0028/0030). Admin-udløst —
 * bevidst afkoblet fra afholdelses-flippet, så partnerens registrering aldrig afhænger af
 * betalingsleverandøren.
 *
 * Alunta har intet synkront træk: succes her betyder at forbruget er INDBERETTET
 * (status 'rapporteret') og afregnes på leverandørens næste periodefaktura. Webhooken
 * (invoice.paid/payment_failed) er autoritativ for gennemført/fejlet. Indberetningen er
 * idempotent hos leverandøren via idempotency_key = payment_charge.id (~30 dages vindue).
 *
 * Med stub aktiv (ingen nøgler) kaster porten NotConfiguredError → rækkerne bliver ærligt
 * stående som 'afventer', og admin ser årsagen.
 */

import { revalidatePath } from "next/cache";

import type { AuthFormState } from "@/components/AuthForm";
import { createPaymentProvider } from "@/lib/payments";
import { NotConfiguredError } from "@/lib/errors";
import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";

interface PendingChargeRow {
  id: string;
  amount_minor: number;
  membership:
    | { provider_customer_ref: string | null }
    | Array<{ provider_customer_ref: string | null }>
    | null;
}

export async function processPendingCharges(
  _prev: AuthFormState,
  _formData: FormData,
): Promise<AuthFormState> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) return { error: "Supabase er ikke konfigureret." };
  try {
    requireRole(await getCurrentUser(), "admin");
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const service = createServiceSupabase(config);
  const { data, error } = await service
    .from("payment_charge")
    .select("id, amount_minor, membership(provider_customer_ref)")
    .eq("status", "afventer");
  if (error) return { error: `Kunne ikke læse afventende opkrævninger: ${error.message}` };

  const rows = (data ?? []) as unknown as PendingChargeRow[];
  if (rows.length === 0) return { error: "Ingen afventende opkrævninger." };

  const provider = createPaymentProvider();
  let reported = 0;
  for (const row of rows) {
    const membership = Array.isArray(row.membership) ? row.membership[0] : row.membership;
    if (!membership?.provider_customer_ref) continue; // kort ikke registreret — ærligt afventende

    try {
      const result = await provider.reportUsageCharge({
        customerRef: membership.provider_customer_ref,
        amountMinor: row.amount_minor,
        idempotencyKey: row.id,
        description: "Advisory board-møde (60 min + 15 min forberedelse)",
      });
      await service
        .from("payment_charge")
        .update({
          provider_charge_ref: result.id,
          status: "rapporteret",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      reported += 1;
    } catch (e) {
      if (e instanceof NotConfiguredError) {
        // Stub aktiv: lad rækkerne stå som 'afventer' og fortæl admin præcis hvorfor.
        return { error: e.message };
      }
      await service
        .from("payment_charge")
        .update({
          status: "fejlet",
          failure_reason: e instanceof Error ? e.message : String(e),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
  }

  revalidatePath("/admin/priser");
  revalidatePath("/betaling");
  return reported > 0 ? {} : { error: "Intet kunne indberettes (kort mangler?)." };
}
