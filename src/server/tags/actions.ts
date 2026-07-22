"use server";

/**
 * Admin-mutationer for kompetence-tags (Fase 1-fundament, ADR 0016). Skriv sker via service-role
 * (bypasser RLS) bag et app-lags requireRole('admin')-check — defense-in-depth sammen med
 * competence_tag-RLS og admin-rute-guarden. `.select()` på hver skrivning bekræfter at rækken
 * faktisk blev ramt (fanger tavse fejl, som ved provisionOwner).
 */

import { revalidatePath } from "next/cache";

import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import type { SupabaseAuthConfig } from "@/server/auth/supabase-config";
import { slugify } from "./slug";

/** Sikrer konfiguration + at kalderen er admin. Returnerer configen til brug i skrivningen. */
async function requireAdminConfig(): Promise<SupabaseAuthConfig> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) {
    throw new Error("Supabase er ikke konfigureret.");
  }
  requireRole(await getCurrentUser(), "admin");
  return config;
}

function parseSortOrder(formData: FormData): number {
  const n = Number(formData.get("sort_order"));
  return Number.isFinite(n) ? n : 0;
}

export async function createTagAction(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const label = String(formData.get("label") ?? "").trim();
  if (!label) throw new Error("Label må ikke være tom.");

  const service = createServiceSupabase(config);
  const { data, error } = await service
    .from("competence_tag")
    .insert({ slug: slugify(label), label, sort_order: parseSortOrder(formData) })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke oprette tag: ${error?.message ?? "ingen række skrevet"}`);
  }
  revalidatePath("/admin/tags");
}

export async function updateTagAction(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const id = String(formData.get("id") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  if (!id || !label) throw new Error("Id og label er påkrævet.");

  const service = createServiceSupabase(config);
  const { data, error } = await service
    .from("competence_tag")
    .update({ label, sort_order: parseSortOrder(formData) })
    .eq("id", id)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke opdatere tag: ${error?.message ?? "ingen række ramt"}`);
  }
  revalidatePath("/admin/tags");
}

export async function deleteTagAction(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Id er påkrævet.");

  const service = createServiceSupabase(config);
  const { data, error } = await service
    .from("competence_tag")
    .delete()
    .eq("id", id)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke slette tag: ${error?.message ?? "ingen række ramt"}`);
  }
  revalidatePath("/admin/tags");
}
