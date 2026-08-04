"use server";

/**
 * Provider-træk af afventende opkrævninger (Fase 3, ADR 0028/0029). Admin-udløst — selve
 * trækket er BEVIDST afkoblet fra afholdelses-flippet, så partnerens registrering aldrig
 * afhænger af betalingsleverandøren. Med stub aktiv (ingen Alunta-nøgler) kaster porten
 * NotConfiguredError → rækkerne bliver ærligt stående som 'afventer', og admin ser årsagen.
 *
 * Webhooken (ADR 0027-mønstret) er den autoritative kilde til gennemført/fejlet; dette
 * kald sætter kun provider_charge_ref + optimistisk status ved synkront svar.
 */

import { revalidatePath } from "next/cache";

import type { AuthFormState } from "@/components/AuthForm";
import { createPaymentProvider } from "@/lib/payments";
import type { PaymentFrequencyWeeks } from "@/lib/payments";
import { NotConfiguredError } from "@/lib/errors";
import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";

interface PendingChargeRow {
  id: string;
  amount_minor: number;
  currency: string;
  membership: {
    provider_customer_ref: string | null;
    frequency_weeks: number;
  } | Array<{ provider_customer_ref: string | null; frequency_weeks: number }> | null;
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
    .select("id, amount_minor, currency, membership(provider_customer_ref, frequency_weeks)")
    .eq("status", "afventer");
  if (error) return { error: `Kunne ikke læse afventende træk: ${error.message}` };

  const rows = (data ?? []) as unknown as PendingChargeRow[];
  if (rows.length === 0) return { error: "Ingen afventende træk." };

  const provider = createPaymentProvider();
  let processed = 0;
  for (const row of rows) {
    const membership = Array.isArray(row.membership) ? row.membership[0] : row.membership;
    if (!membership?.provider_customer_ref) continue; // kort ikke registreret — ærligt afventende

    try {
      const result = await provider.charge({
        customerRef: membership.provider_customer_ref,
        amountMinor: row.amount_minor,
        currency: row.currency,
        frequencyWeeks: membership.frequency_weeks as PaymentFrequencyWeeks,
        description: "Advisory board-møde (60 min + 15 min forberedelse)",
      });
      await service
        .from("payment_charge")
        .update({
          provider_charge_ref: result.id,
          status: "gennemfoert",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      processed += 1;
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
  return processed > 0 ? {} : { error: "Ingen træk kunne processeres (kort mangler?)." };
}
