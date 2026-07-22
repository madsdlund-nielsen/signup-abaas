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
import type { QuizOptionKind, QuizQuestionKind } from "./index";

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

function parseOptionKind(formData: FormData): QuizOptionKind {
  const raw = String(formData.get("kind"));
  return raw === "tag" || raw === "frequency" || raw === "free_text" ? raw : "tag";
}

/** frequency_weeks er kun gyldig for 'frequency'-options (DB-check). Ellers null. */
function parseFrequencyWeeks(formData: FormData, kind: QuizOptionKind): number | null {
  if (kind !== "frequency") return null;
  const n = Number(formData.get("frequency_weeks"));
  return Number.isFinite(n) && n > 0 ? n : null;
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

// --- Options (svarmuligheder) — knyttet til ét spørgsmål; skrives via service-role. ---

export async function createOption(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const questionId = String(formData.get("question_id") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  if (!questionId || !label) throw new Error("Spørgsmåls-id og etiket er påkrævet.");

  const kind = parseOptionKind(formData);
  const service = createServiceSupabase(config);
  const { data, error } = await service
    .from("quiz_option")
    .insert({
      quiz_question_id: questionId,
      label,
      kind,
      frequency_weeks: parseFrequencyWeeks(formData, kind),
      sort_order: parseSortOrder(formData),
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke oprette svarmulighed: ${error?.message ?? "ingen række skrevet"}`);
  }
  revalidatePath(`/admin/quiz/${questionId}`);
}

export async function updateOption(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const id = String(formData.get("id") ?? "");
  const questionId = String(formData.get("question_id") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  if (!id || !label) throw new Error("Id og etiket er påkrævet.");

  const kind = parseOptionKind(formData);
  const service = createServiceSupabase(config);
  const { data, error } = await service
    .from("quiz_option")
    .update({ label, kind, frequency_weeks: parseFrequencyWeeks(formData, kind) })
    .eq("id", id)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke opdatere svarmulighed: ${error?.message ?? "ingen række ramt"}`);
  }
  revalidatePath(`/admin/quiz/${questionId}`);
}

export async function deleteOption(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const id = String(formData.get("id") ?? "");
  const questionId = String(formData.get("question_id") ?? "");
  if (!id) throw new Error("Id er påkrævet.");

  const service = createServiceSupabase(config);
  const { data, error } = await service
    .from("quiz_option")
    .delete()
    .eq("id", id)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke slette svarmulighed: ${error?.message ?? "ingen række ramt"}`);
  }
  revalidatePath(`/admin/quiz/${questionId}`);
}

/** Byt sort_order med naboen blandt options i SAMME spørgsmål. No-op ved kant. */
export async function moveOption(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const id = String(formData.get("id") ?? "");
  const questionId = String(formData.get("question_id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!id || !questionId) throw new Error("Id og spørgsmåls-id er påkrævet.");

  const service = createServiceSupabase(config);
  const { data: options, error } = await service
    .from("quiz_option")
    .select("id, sort_order")
    .eq("quiz_question_id", questionId)
    .order("sort_order");
  if (error || !options) {
    throw new Error(`Kunne ikke læse rækkefølge: ${error?.message ?? "ingen data"}`);
  }

  const rows = options as Array<{ id: string; sort_order: number }>;
  const idx = rows.findIndex((o) => o.id === id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= rows.length) return; // kant → no-op

  const a = rows[idx];
  const b = rows[swapIdx];
  await service.from("quiz_option").update({ sort_order: b.sort_order }).eq("id", a.id);
  await service.from("quiz_option").update({ sort_order: a.sort_order }).eq("id", b.id);
  revalidatePath(`/admin/quiz/${questionId}`);
}

/**
 * Sæt kompetence-tag-koblingen for én option (erstat-hele-sættet). Checkbox-picker sender 0..n
 * 'tag'-værdier. Frekvens/fritekst-options har ingen mapping. Dette er hvad 1.5 matching læser.
 */
export async function setOptionTags(formData: FormData): Promise<void> {
  const config = await requireAdminConfig();
  const optionId = String(formData.get("option_id") ?? "");
  const questionId = String(formData.get("question_id") ?? "");
  if (!optionId) throw new Error("Option-id er påkrævet.");

  const tagIds = formData
    .getAll("tag")
    .map((v) => String(v))
    .filter((v) => v.length > 0);

  const service = createServiceSupabase(config);
  const { error: delError } = await service
    .from("quiz_option_competence_tag")
    .delete()
    .eq("quiz_option_id", optionId);
  if (delError) {
    throw new Error(`Kunne ikke rydde tag-kobling: ${delError.message}`);
  }

  if (tagIds.length > 0) {
    const { error: insError } = await service
      .from("quiz_option_competence_tag")
      .insert(tagIds.map((competenceTagId) => ({
        quiz_option_id: optionId,
        competence_tag_id: competenceTagId,
      })));
    if (insError) {
      throw new Error(`Kunne ikke gemme tag-kobling: ${insError.message}`);
    }
  }
  revalidatePath(`/admin/quiz/${questionId}`);
}
