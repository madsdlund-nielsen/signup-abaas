/**
 * Læsning af den nuværende ejers egne quiz-svar (Fase 1.3, ADR 0018). Via den authed server-klient:
 * RLS-policyen `quiz_answer_select_owner` scoper automatisk til `auth.uid()`, så der læses aldrig
 * andres svar. Bruges til prefil af onboarding-flowet + kvittering. Ukonfigureret Supabase → [].
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

export interface OwnerAnswer {
  optionId: string;
  freeText: string | null;
}

export async function getMyAnswers(
  env: Record<string, string | undefined> = process.env,
): Promise<OwnerAnswer[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase.from("quiz_answer").select("quiz_option_id, free_text");
  if (error) {
    console.error(`[quiz] getMyAnswers fejlede: ${error.message}`);
    return [];
  }
  return ((data ?? []) as Array<{ quiz_option_id: string; free_text: string | null }>).map((row) => ({
    optionId: row.quiz_option_id,
    freeText: row.free_text,
  }));
}
