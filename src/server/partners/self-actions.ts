"use server";

/**
 * Partnerens self-service-profil-redigering (Fase 2.8, ADR 0025). Service-role bag
 * requireRole('partner') + EKSPLICIT ejerskabstjek (app_user_id = den nuværende bruger) —
 * service-role bypasser RLS, så ejerskabet verificeres her, som i boards/actions.
 *
 * Partneren må redigere egen profil-INFO — ALDRIG kompetence-tags (admin-styret, ADR 0019),
 * og heller ikke is_internal/sort_order (admin-forvaltning af kataloget).
 */

import { revalidatePath } from "next/cache";

import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";

function optionalText(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value.length > 0 ? value : null;
}

export async function updateMyPartnerProfile(formData: FormData): Promise<void> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  const user = requireRole(await getCurrentUser(), "partner");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Navn må ikke være tomt.");

  const service = createServiceSupabase(config);
  const { data, error } = await service
    .from("partner_profile")
    .update({
      name,
      title: optionalText(formData, "title"),
      languages: optionalText(formData, "languages"),
      personal_info: optionalText(formData, "personal_info"),
      short_bio: optionalText(formData, "short_bio"),
      long_bio: optionalText(formData, "long_bio"),
      photo_url: optionalText(formData, "photo_url"),
      updated_at: new Date().toISOString(),
    })
    .eq("app_user_id", user.id)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke opdatere profilen: ${error?.message ?? "ingen katalogpost koblet"}`);
  }

  revalidatePath("/partner");
}
