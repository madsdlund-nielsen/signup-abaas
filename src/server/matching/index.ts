/**
 * Læsevej for board-matching (Fase 1.5, ADR 0021/0022). Selve algoritmen ligger i ./algorithm (ren,
 * DB-fri). Her hentes de to input: ejerens kompetence-tags (fra quiz-svarene) og partner-puljen.
 *
 * ADGANG: ejerens tags læses med den AUTHED klient — `quiz_answer_select_owner` scoper til auth.uid(),
 * så der læses aldrig andres svar. Puljen læses derimod med SERVICE-ROLE bag requireRole('ejer'):
 * kataloget er admin-only i RLS, og ejeren får bevidst kun en read-policy på de profiler der sidder
 * på hendes eget board (0010, GDPR). Matchingen skal se hele puljen for at kunne vælge — men kun
 * serveren, aldrig klienten.
 *
 * Ukonfigureret Supabase → tom/null (kontofri CI/dev).
 */

import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase, createServiceSupabase } from "@/server/auth/supabase-server";
import { getMyAnswers } from "@/server/quiz/answers";
import { matchBoard, type BoardMatch, type MatchCandidate } from "./algorithm";

export * from "./algorithm";

/** Kandidat + de profilfelter board-anbefalingen viser (byggespec §5.3 / fase-1.md §1.6). */
export interface MatchPartner extends MatchCandidate {
  title: string | null;
  shortBio: string | null;
  longBio: string | null;
  photoUrl: string | null;
}

export interface BoardRecommendation {
  match: BoardMatch;
  /** De valgte partnere i match-rækkefølge (intern først). */
  selected: MatchPartner[];
  /** Hele puljen — driver "udskift"-valget. Forlader aldrig serveren i sin helhed. */
  pool: MatchPartner[];
}

interface PoolRow {
  id: string;
  name: string;
  title: string | null;
  is_internal: boolean;
  short_bio: string | null;
  long_bio: string | null;
  photo_url: string | null;
  sort_order: number;
  partner_profile_competence_tag: Array<{ competence_tag_id: string }> | null;
}

// Én sammenhængende literal: konkatenering ville udvide typen til `string`, og så kan supabase-js
// ikke udlede rækketypen af select-strengen (samme mønster som PARTNER_COLUMNS i src/server/partners).
const POOL_COLUMNS =
  "id, name, title, is_internal, short_bio, long_bio, photo_url, sort_order, partner_profile_competence_tag(competence_tag_id)";

function rowToMatchPartner(row: PoolRow): MatchPartner {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    isInternal: row.is_internal,
    shortBio: row.short_bio,
    longBio: row.long_bio,
    photoUrl: row.photo_url,
    sortOrder: row.sort_order,
    competenceTagIds: (row.partner_profile_competence_tag ?? []).map((t) => t.competence_tag_id),
  };
}

/**
 * Ejerens ønskede kompetence-tags, udledt af hendes quiz-svar.
 *
 * Join-vejen står som kommentar i 0008: quiz_answer → quiz_option_competence_tag → competence_tag.
 * Genbruger `getMyAnswers` (RLS-scopet) frem for en nested embed, så kun ét fragilt led findes ét sted.
 * Frekvens-options (`frequency_weeks`, 4/8/12) har ingen tag-kobling og falder derfor naturligt ud —
 * mødekadence er ikke et kompetencesignal.
 */
export async function getMyCompetenceTagIds(
  env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const optionIds = (await getMyAnswers(env)).map((answer) => answer.optionId);
  if (optionIds.length === 0) return [];

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("quiz_option_competence_tag")
    .select("competence_tag_id")
    .in("quiz_option_id", optionIds);
  if (error) {
    console.error(`[matching] getMyCompetenceTagIds fejlede: ${error.message}`);
    return [];
  }
  return [...new Set(((data ?? []) as Array<{ competence_tag_id: string }>).map((r) => r.competence_tag_id))];
}

/**
 * Hele partner-puljen. Service-role bag requireRole('ejer') — se adgangsnoten øverst.
 *
 * TODO(mads): kalenderplads-filter. Byggespec §5.2 kræver at udskift kun viser "partnere med
 * kalenderplads"; det forudsætter Cal.com multi-host (fase 2, src/lib/booking/port.ts).
 */
export async function listMatchCandidates(
  env: Record<string, string | undefined> = process.env,
): Promise<MatchPartner[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];
  requireRole(await getCurrentUser(env), "ejer");

  const { data, error } = await createServiceSupabase(config)
    .from("partner_profile")
    .select(POOL_COLUMNS)
    .order("sort_order");
  if (error) {
    console.error(`[matching] listMatchCandidates fejlede: ${error.message}`);
    return [];
  }
  return ((data ?? []) as PoolRow[]).map(rowToMatchPartner);
}

/** Anbefalet board for den nuværende ejer: hendes tags × puljen → 2-3 partnere. */
export async function getBoardRecommendation(
  env: Record<string, string | undefined> = process.env,
): Promise<BoardRecommendation> {
  const [ownerTagIds, pool] = await Promise.all([
    getMyCompetenceTagIds(env),
    listMatchCandidates(env),
  ]);

  const match = matchBoard(ownerTagIds, pool);
  const byId = new Map(pool.map((partner) => [partner.id, partner]));

  return {
    match,
    selected: match.partnerIds
      .map((id) => byId.get(id))
      .filter((partner): partner is MatchPartner => partner != null),
    pool,
  };
}
