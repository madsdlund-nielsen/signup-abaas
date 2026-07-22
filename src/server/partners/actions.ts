"use server";

/**
 * Admin-mutationer for partner-kataloget (Fase 1.4, ADR 0019). Skriv via service-role bag
 * requireRole('admin') med .select()-verify-readback (spejler src/server/tags + quiz/actions).
 * Tags tildeles autoritativt af admin (setPartnerTags = replace-whole-set); partnere kan ikke
 * redigere egne tags (ingen partner-writes overhovedet i 1.4).
 */

import { revalidatePath } from "next/cache";

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

function parseSortOrder(formData: FormData): number {
  const n = Number(formData.get("sort_order"));
  return Number.isFinite(n) ? n : 0;
}

function optionalText(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value.length > 0 ? value : null;
}

/** Felter der er fælles for opret/redigér. `is_internal` er en checkbox (til stede = intern). */
function partnerFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    title: optionalText(formData, "title"),
    is_internal: formData.get("is_internal") != null,
    languages: optionalText(formData, "languages"),
    personal_info: optionalText(formData, "personal_info"),
    short_bio: optionalText(formData, "short_bio"),
    long_bio: optionalText(formData, "long_bio"),
    photo_url: optionalText(formData, "photo_url"),
  };
}

export async function createPartner(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const fields = partnerFields(formData);
  if (!fields.name) throw new Error("Navn må ikke være tomt.");

  const service = createServiceSupabase(config);
  const { data, error } = await service
    .from("partner_profile")
    .insert({ ...fields, sort_order: parseSortOrder(formData) })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke oprette partner: ${error?.message ?? "ingen række skrevet"}`);
  }
  revalidatePath("/admin/partners");
}

export async function updatePartner(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const id = String(formData.get("id") ?? "");
  const fields = partnerFields(formData);
  if (!id || !fields.name) throw new Error("Id og navn er påkrævet.");

  const service = createServiceSupabase(config);
  const { data, error } = await service
    .from("partner_profile")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke opdatere partner: ${error?.message ?? "ingen række ramt"}`);
  }
  revalidatePath("/admin/partners");
  revalidatePath(`/admin/partners/${id}`);
}

export async function deletePartner(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Id er påkrævet.");

  const service = createServiceSupabase(config);
  const { data, error } = await service
    .from("partner_profile")
    .delete()
    .eq("id", id)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke slette partner: ${error?.message ?? "ingen række ramt"}`);
  }
  revalidatePath("/admin/partners");
}

/**
 * Sæt kompetence-tag-koblingen for én partner (erstat-hele-sættet, spejler setOptionTags). Checkbox-
 * picker sender 0..n tag-id'er. Admin er eneste skrivevej (partnere kan ikke redigere egne tags).
 */
export async function setPartnerTags(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const partnerId = String(formData.get("partner_id") ?? "");
  if (!partnerId) throw new Error("Partner-id er påkrævet.");

  const tagIds = formData
    .getAll("tag")
    .map((v) => String(v))
    .filter((v) => v.length > 0);

  const service = createServiceSupabase(config);
  const { error: delError } = await service
    .from("partner_profile_competence_tag")
    .delete()
    .eq("partner_profile_id", partnerId);
  if (delError) {
    throw new Error(`Kunne ikke rydde tag-kobling: ${delError.message}`);
  }

  if (tagIds.length > 0) {
    const { error: insError } = await service
      .from("partner_profile_competence_tag")
      .insert(tagIds.map((competenceTagId) => ({
        partner_profile_id: partnerId,
        competence_tag_id: competenceTagId,
      })));
    if (insError) {
      throw new Error(`Kunne ikke gemme tag-kobling: ${insError.message}`);
    }
  }
  revalidatePath(`/admin/partners/${partnerId}`);
}
