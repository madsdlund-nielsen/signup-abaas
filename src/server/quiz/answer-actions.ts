"use server";

/**
 * Ejer-mutation: gem den nuværende ejers quiz-svar (Fase 1.3, ADR 0018). MODSAT admin-writes
 * (service-role) skrives ejer-svar via den AUTHED klient — RLS-policyen `quiz_answer_insert_owner`
 * håndhæver `owner_id = auth.uid()` og at optionen hører til et published spørgsmål. App-lags-
 * `requireRole('ejer')` er forsvar-i-dybden. Replace-whole-set: ryd egne svar, indsæt de nye.
 */

import { revalidatePath } from "next/cache";

import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

export interface AnswerInput {
  optionId: string;
  freeText?: string;
}

export async function saveMyAnswers(selections: AnswerInput[]): Promise<void> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  const user = requireRole(await getCurrentUser(), "ejer");

  const supabase = await createServerSupabase(config);

  // Ryd ejerens tidligere svar (RLS `quiz_answer_delete_owner` begrænser til auth.uid()).
  const { error: delError } = await supabase.from("quiz_answer").delete().eq("owner_id", user.id);
  if (delError) throw new Error(`Kunne ikke rydde tidligere svar: ${delError.message}`);

  const rows = selections
    .filter((selection) => selection.optionId)
    .map((selection) => ({
      owner_id: user.id,
      quiz_option_id: selection.optionId,
      free_text: selection.freeText?.trim() ? selection.freeText.trim() : null,
    }));

  if (rows.length > 0) {
    const { error: insError } = await supabase.from("quiz_answer").insert(rows);
    if (insError) throw new Error(`Kunne ikke gemme svar: ${insError.message}`);
  }

  revalidatePath("/onboarding");
  revalidatePath("/dashboard");
}
