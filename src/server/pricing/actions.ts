"use server";

/**
 * Admin-mutationer for prisregler (Fase 3, ADR 0030). Service-role bag requireRole('admin')
 * med verify-readback. Versioner er APPEND-ONLY: en ny version oprettes, en version
 * aktiveres — eksisterende rækker redigeres aldrig (audit: payment_charge refererer den
 * version der blev anvendt). Værdierne kommer fra admins indtastning — aldrig fra kode.
 */

import { revalidatePath } from "next/cache";

import type { AuthFormState } from "@/components/AuthForm";
import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import type { SupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";

async function requireAdminConfig(): Promise<SupabaseAuthConfig> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  requireRole(await getCurrentUser(), "admin");
  return config;
}

function readAmount(formData: FormData, key: string): number {
  const value = Number(formData.get(key));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Ugyldigt beløb i '${key}' — angiv hele øre (heltal ≥ 0).`);
  }
  return value;
}

function readFactor(formData: FormData, key: string): number {
  const value = Number(formData.get(key));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Ugyldig faktor i '${key}' — angiv et positivt tal.`);
  }
  return value;
}

/** Opret en ny (inaktiv) version. Aktivering er et separat, eksplicit skridt. */
export async function createPricingRule(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const config = await requireAdminConfig();
    const service = createServiceSupabase(config);

    const { data: latest, error: latestError } = await service
      .from("pricing_rule")
      .select("version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) return { error: `Kunne ikke læse versioner: ${latestError.message}` };
    const nextVersion = ((latest as { version: number } | null)?.version ?? 0) + 1;

    const { data, error } = await service
      .from("pricing_rule")
      .insert({
        version: nextVersion,
        base_amount_minor: readAmount(formData, "base_amount_minor"),
        per_partner_amount_minor: readAmount(formData, "per_partner_amount_minor"),
        factor_4_weeks: readFactor(formData, "factor_4_weeks"),
        factor_8_weeks: readFactor(formData, "factor_8_weeks"),
        factor_12_weeks: readFactor(formData, "factor_12_weeks"),
      })
      .select("id")
      .single();
    if (error || !data) {
      return { error: `Kunne ikke oprette version: ${error?.message ?? "ingen række skrevet"}` };
    }

    revalidatePath("/admin/priser");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Aktivér én version (deaktiverer den nuværende). To skridt uden transaktion — den partielle
 * unique-constraint `pricing_rule_one_active` gør rækkefølgen sikker: fejler aktiveringen,
 * står systemet uden aktiv regel (prisberegning fejler højlydt) frem for med to.
 */
export async function activatePricingRule(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Versions-id er påkrævet.");

  const service = createServiceSupabase(config);
  const { error: clearError } = await service
    .from("pricing_rule")
    .update({ is_active: false })
    .eq("is_active", true);
  if (clearError) throw new Error(`Kunne ikke deaktivere nuværende version: ${clearError.message}`);

  const { data, error } = await service
    .from("pricing_rule")
    .update({ is_active: true })
    .eq("id", id)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke aktivere versionen: ${error?.message ?? "ingen række ramt"}`);
  }

  revalidatePath("/admin/priser");
  revalidatePath("/betaling");
}
