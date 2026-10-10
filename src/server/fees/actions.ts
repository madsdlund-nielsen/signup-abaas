"use server";

/**
 * Admin-mutation for honorarregler (Fase 5.1, ADR 0051). Service-role bag requireRole('admin').
 * Versioner er APPEND-ONLY: en ny version oprettes, eksisterende rækker redigeres aldrig — og der
 * er intet "aktivér"-skridt, fordi en version gælder fra sit `effective_from` (modsat prisregler).
 * Værdierne kommer fra admins indtastning — aldrig fra kode.
 */

import { revalidatePath } from "next/cache";

import type { AuthFormState } from "@/components/AuthForm";
import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import type { SupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { parseNewFeeRule } from "./rule-input";

async function requireAdminConfig(): Promise<SupabaseAuthConfig> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  requireRole(await getCurrentUser(), "admin");
  return config;
}

function readField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Opret en ny regelversion. Versionsnummer = nyeste + 1. */
export async function createFeeRule(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const config = await requireAdminConfig();
    const service = createServiceSupabase(config);

    const { data: existing, error: existingError } = await service
      .from("fee_rule")
      .select("version, effective_from");
    if (existingError) return { error: `Kunne ikke læse versioner: ${existingError.message}` };
    const versions = (existing ?? []) as Array<{ version: number; effective_from: string }>;
    const maxVersion = versions.reduce((max, row) => Math.max(max, row.version), 0);
    // "Nyeste" i gyldighed = størst effective_from (ikke nødvendigvis højeste versionsnummer).
    const latestEffectiveFrom = versions.reduce<string | null>(
      (latest, row) =>
        latest === null || new Date(row.effective_from) > new Date(latest)
          ? row.effective_from
          : latest,
      null,
    );

    const parsed = parseNewFeeRule(
      {
        hourlyRate: readField(formData, "hourly_rate_minor"),
        vatMode: readField(formData, "vat_mode"),
        absenceRule: readField(formData, "absence_rule"),
        effectiveFrom: readField(formData, "effective_from"),
      },
      latestEffectiveFrom,
    );
    if (!parsed.ok) return { error: parsed.error };

    const { data, error } = await service
      .from("fee_rule")
      .insert({
        version: maxVersion + 1,
        hourly_rate_minor: parsed.value.hourlyRateMinor,
        vat_mode: parsed.value.vatMode,
        absence_rule: parsed.value.absenceRule,
        effective_from: parsed.value.effectiveFrom,
      })
      .select("id")
      .single();
    if (error || !data) {
      return { error: `Kunne ikke oprette version: ${error?.message ?? "ingen række skrevet"}` };
    }

    revalidatePath("/admin/honorar");
    revalidatePath("/partner/honorar");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
