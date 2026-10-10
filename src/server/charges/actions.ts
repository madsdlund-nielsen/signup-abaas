"use server";

/**
 * Admin-udløst synkronisering af afventende periode-opkrævninger til betalingsleverandørens
 * abonnement (B-19, ADR 0056). Den samme synkronisering kører efter den planlagte oprettelse
 * (`/api/cron/charge-periods`); knappen her er til at gentage den når en nøgle eller et
 * kort er kommet på plads. Bevidst afkoblet fra mødeafholdelse, så partnerens registrering
 * aldrig afhænger af betalingsleverandøren.
 *
 * Succes her betyder at abonnementets pris er MELDT (status 'rapporteret'); leverandøren
 * fakturerer selv, og webhooken (invoice.paid/payment_failed) er autoritativ for gennemført/fejlet.
 * Se ./sync for fejlsemantikken.
 */

import { revalidatePath } from "next/cache";

import type { AuthFormState } from "@/components/AuthForm";
import { createPaymentProvider } from "@/lib/payments";
import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";

import { syncPendingSubscriptions } from "./sync";

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

  let result;
  try {
    result = await syncPendingSubscriptions(createServiceSupabase(config), createPaymentProvider());
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  revalidatePath("/admin/priser");
  revalidatePath("/betaling");
  if (result.notConfigured) return { error: result.notConfigured };
  if (result.reported === 0) {
    return {
      error:
        result.failed > 0
          ? "Intet kunne meldes til leverandøren (kort eller abonnement mangler?)."
          : "Ingen afventende opkrævninger.",
    };
  }
  return {};
}
