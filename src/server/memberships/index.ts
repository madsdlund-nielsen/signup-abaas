/**
 * Business-data-access for medlemskab (Fase 3, ADR 0028). Læsning via authed klient —
 * RLS scoper til ejerens eget membership (via board). Writes i ./actions.
 * Ukonfigureret Supabase → null (kontofri CI/dev).
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";
import type { FrequencyWeeks } from "@/server/pricing/algorithm";

export interface Membership {
  id: string;
  boardId: string;
  frequencyWeeks: FrequencyWeeks;
  status: "aktiv" | "opsagt";
  cardStatus: "mangler" | "registreret";
}

interface MembershipRow {
  id: string;
  board_id: string;
  frequency_weeks: number;
  status: "aktiv" | "opsagt";
  card_status: "mangler" | "registreret";
}

/** Den nuværende ejers membership, eller null hvis intet er oprettet endnu. */
export async function getMyMembership(
  env: Record<string, string | undefined> = process.env,
): Promise<Membership | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("membership")
    .select("id, board_id, frequency_weeks, status, card_status")
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error(`[memberships] getMyMembership fejlede: ${error.message}`);
    return null;
  }
  const row = data as MembershipRow;
  return {
    id: row.id,
    boardId: row.board_id,
    frequencyWeeks: row.frequency_weeks as FrequencyWeeks,
    status: row.status,
    cardStatus: row.card_status,
  };
}

/** Ejerens frekvensvalg fra quizzen (quiz_option.frequency_weeks via egne svar), eller null. */
export async function getMyQuizFrequency(
  env: Record<string, string | undefined> = process.env,
): Promise<FrequencyWeeks | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("quiz_answer")
    .select("quiz_option(frequency_weeks)")
    .not("quiz_option.frequency_weeks", "is", null);
  if (error) {
    console.error(`[memberships] getMyQuizFrequency fejlede: ${error.message}`);
    return null;
  }
  for (const row of (data ?? []) as unknown as Array<{
    quiz_option: { frequency_weeks: number | null } | Array<{ frequency_weeks: number | null }> | null;
  }>) {
    const option = Array.isArray(row.quiz_option) ? row.quiz_option[0] : row.quiz_option;
    const weeks = option?.frequency_weeks;
    if (weeks === 4 || weeks === 8 || weeks === 12) return weeks;
  }
  return null;
}
