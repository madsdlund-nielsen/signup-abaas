"use server";

/**
 * Admin-mutationer for quiz-spørgsmål (Fase 1.2, ADR 0017). Skriv via service-role bag
 * requireRole('admin') med .select()-verify-readback (spejler src/server/tags/actions).
 * Options + tag-mapping kommer i PR 2.
 */

import { revalidatePath } from "next/cache";

import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import type { SupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { slugify } from "@/server/tags/slug";
import type { QuizQuestionKind } from "./index";

async function requireAdminConfig(): Promise<SupabaseAuthConfig> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  requireRole(await getCurrentUser(), "admin");
  return config;
}

function parseKind(formData: FormData): QuizQuestionKind {
  return String(formData.get("kind")) === "multi" ? "multi" : "single";
}

function parseSortOrder(formData: FormData): number {
  const n = Number(formData.get("sort_order"));
  return Number.isFinite(n) ? n : 0;
}

export async function createQuestion(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) throw new Error("Spørgsmålstekst må ikke være tom.");

  const service = createServiceSupabase(config);
  const { data, error } = await service
    .from("quiz_question")
    .insert({
      key: slugify(prompt),
      prompt,
      kind: parseKind(formData),
      sort_order: parseSortOrder(formData),
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke oprette spørgsmål: ${error?.message ?? "ingen række skrevet"}`);
  }
  revalidatePath("/admin/quiz");
}

export async function updateQuestion(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const id = String(formData.get("id") ?? "");
  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!id || !prompt) throw new Error("Id og spørgsmålstekst er påkrævet.");

  // key holdes stabil (referencepunkt for 1.3/1.5) — regenereres ikke ved redigering.
  const service = createServiceSupabase(config);
  const { data, error } = await service
    .from("quiz_question")
    .update({
      prompt,
      kind: parseKind(formData),
      is_published: formData.get("is_published") != null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke opdatere spørgsmål: ${error?.message ?? "ingen række ramt"}`);
  }
  revalidatePath("/admin/quiz");
  revalidatePath(`/admin/quiz/${id}`);
}

export async function deleteQuestion(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Id er påkrævet.");

  const service = createServiceSupabase(config);
  const { data, error } = await service
    .from("quiz_question")
    .delete()
    .eq("id", id)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke slette spørgsmål: ${error?.message ?? "ingen række ramt"}`);
  }
  revalidatePath("/admin/quiz");
}

/** Byt sort_order med naboen i den valgte retning (op/ned). No-op ved listens kant. */
export async function moveQuestion(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const id = String(formData.get("id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!id) throw new Error("Id er påkrævet.");

  const service = createServiceSupabase(config);
  const { data: questions, error } = await service
    .from("quiz_question")
    .select("id, sort_order")
    .order("sort_order");
  if (error || !questions) {
    throw new Error(`Kunne ikke læse rækkefølge: ${error?.message ?? "ingen data"}`);
  }

  const rows = questions as Array<{ id: string; sort_order: number }>;
  const idx = rows.findIndex((q) => q.id === id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= rows.length) return; // kant → no-op

  const a = rows[idx];
  const b = rows[swapIdx];
  await service.from("quiz_question").update({ sort_order: b.sort_order }).eq("id", a.id);
  await service.from("quiz_question").update({ sort_order: a.sort_order }).eq("id", b.id);
  revalidatePath("/admin/quiz");
}
