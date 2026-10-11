/**
 * En ejers kompetencebehov som tag-id'er, læst med SERVICE-ROLE (ADR 0055, ADR 0062).
 *
 * Join-vejen er den samme som `getMyCompetenceTagIds`: quiz_answer → quiz_option_competence_tag.
 * Forskellen er hvem der læser: den funktion bruger ejerens egen RLS-scopede session, mens denne
 * læser FOR en anden — lead-partnerens dashboard og admins board-editor. Kalderen skal derfor selv
 * have afgjort at brugeren må se netop denne ejers behov (lead på boardet / rollen admin) FØR
 * kaldet; intet her tjekker det. Kun tag-id'er forlader funktionen, aldrig `free_text`.
 *
 * Returnerer null ved en læsefejl (og logger uden persondata) og [] når ejeren intet har svaret
 * — et dashboard der ikke kan læse behovene må ikke se ud som om ejeren ingen behov har.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function readOwnerTagIds(
  service: SupabaseClient,
  ownerId: string,
): Promise<string[] | null> {
  const answers = await service.from("quiz_answer").select("quiz_option_id").eq("owner_id", ownerId);
  if (answers.error) {
    console.error(`[matching] behovslæsning fejlede: ${answers.error.message}`);
    return null;
  }
  const optionIds = ((answers.data ?? []) as Array<{ quiz_option_id: string }>).map(
    (row) => row.quiz_option_id,
  );
  if (optionIds.length === 0) return [];

  const tags = await service
    .from("quiz_option_competence_tag")
    .select("competence_tag_id")
    .in("quiz_option_id", optionIds);
  if (tags.error) {
    console.error(`[matching] tag-læsning fejlede: ${tags.error.message}`);
    return null;
  }
  return [
    ...new Set(((tags.data ?? []) as Array<{ competence_tag_id: string }>).map((r) => r.competence_tag_id)),
  ];
}
