/**
 * Business-data-access for quiz (Fase 1.2, ADR 0017). Læsning via authed server-klient
 * (RLS: admin ser alt, ejer ser kun published). Admin-writes ligger i ./actions (service-role).
 * Spejler src/server/tags. Ukonfigureret Supabase → tom/null (kontofri CI/dev).
 *
 * PR 1 dækkede spørgsmåls-niveau; PR 2 tilføjer options + kompetence-tag-mapping.
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

export type QuizQuestionKind = "single" | "multi";
export type QuizOptionKind = "tag" | "free_text" | "frequency";

export interface QuizQuestion {
  id: string;
  key: string;
  prompt: string;
  kind: QuizQuestionKind;
  sortOrder: number;
  isPublished: boolean;
}

export interface QuizOption {
  id: string;
  label: string;
  kind: QuizOptionKind;
  frequencyWeeks: number | null;
  sortOrder: number;
  /** Kompetence-tags koblet til denne option (kun 'tag'-options har rækker). 1.5 matching læser dette. */
  competenceTagIds: string[];
}

export interface QuizQuestionDetail extends QuizQuestion {
  options: QuizOption[];
}

interface QuestionRow {
  id: string;
  key: string;
  prompt: string;
  kind: QuizQuestionKind;
  sort_order: number;
  is_published: boolean;
}

interface OptionRow {
  id: string;
  label: string;
  kind: QuizOptionKind;
  frequency_weeks: number | null;
  sort_order: number;
  quiz_option_competence_tag: Array<{ competence_tag_id: string }> | null;
}

const QUESTION_COLUMNS = "id, key, prompt, kind, sort_order, is_published";
const OPTION_COLUMNS =
  "id, label, kind, frequency_weeks, sort_order, quiz_option_competence_tag(competence_tag_id)";

function rowToOption(row: OptionRow): QuizOption {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    frequencyWeeks: row.frequency_weeks,
    sortOrder: row.sort_order,
    competenceTagIds: (row.quiz_option_competence_tag ?? []).map((t) => t.competence_tag_id),
  };
}

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

/**
 * Ét spørgsmål med dets options (inkl. koblede kompetence-tag-ids), sorteret. RLS afgør synlighed:
 * admin ser alt, authed ejer ser kun published. Ukonfigureret/ukendt id → null.
 */
export async function getQuestionDetail(
  id: string,
  env: Record<string, string | undefined> = process.env,
): Promise<QuizQuestionDetail | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;

  const supabase = await createServerSupabase(config);
  const { data: question, error: qErr } = await supabase
    .from("quiz_question")
    .select(QUESTION_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (qErr || !question) return null;

  const { data: options, error: oErr } = await supabase
    .from("quiz_option")
    .select(OPTION_COLUMNS)
    .eq("quiz_question_id", id)
    .order("sort_order");
  if (oErr) {
    console.error(`[quiz] getQuestionDetail: kunne ikke læse options: ${oErr.message}`);
  }

  return {
    ...rowToQuestion(question as QuestionRow),
    options: ((options ?? []) as OptionRow[]).map(rowToOption),
  };
}
