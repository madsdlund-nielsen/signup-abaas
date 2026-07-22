/**
 * Business-data-access for quiz (Fase 1.2, ADR 0017). Læsning via authed server-klient
 * (RLS: admin ser alt, ejer ser kun published). Admin-writes ligger i ./actions (service-role).
 * Spejler src/server/tags. Ukonfigureret Supabase → tom/null (kontofri CI/dev).
 *
 * PR 1 dækker spørgsmåls-niveau; options + tag-mapping kommer i PR 2.
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

export type QuizQuestionKind = "single" | "multi";

export interface QuizQuestion {
  id: string;
  key: string;
  prompt: string;
  kind: QuizQuestionKind;
  sortOrder: number;
  isPublished: boolean;
}

interface QuestionRow {
  id: string;
  key: string;
  prompt: string;
  kind: QuizQuestionKind;
  sort_order: number;
  is_published: boolean;
}

const QUESTION_COLUMNS = "id, key, prompt, kind, sort_order, is_published";

function rowToQuestion(row: QuestionRow): QuizQuestion {
  return {
    id: row.id,
    key: row.key,
    prompt: row.prompt,
    kind: row.kind,
    sortOrder: row.sort_order,
    isPublished: row.is_published,
  };
}

export async function listQuestions(
  env: Record<string, string | undefined> = process.env,
): Promise<QuizQuestion[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("quiz_question")
    .select(QUESTION_COLUMNS)
    .order("sort_order");
  if (error) {
    console.error(`[quiz] listQuestions fejlede: ${error.message}`);
    return [];
  }
  return ((data ?? []) as QuestionRow[]).map(rowToQuestion);
}

export async function getQuestion(
  id: string,
  env: Record<string, string | undefined> = process.env,
): Promise<QuizQuestion | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("quiz_question")
    .select(QUESTION_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToQuestion(data as QuestionRow);
}
