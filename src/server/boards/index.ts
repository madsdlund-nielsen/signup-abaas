/**
 * Business-data-access for ejerens board (Fase 1.5, ADR 0021). Læsning via den authed server-klient:
 * `board_select_owner` scoper til auth.uid(), og `partner_profile_select_board_owner` (0010) giver
 * ejeren adgang til præcis de katalogposter der sidder på hendes eget board — ikke hele puljen.
 * Writes ligger i ./actions (service-role bag requireRole('ejer')).
 *
 * Board-livscyklus er et uafklaret punkt (CLAUDE.md), så modellen holdes livscyklus-agnostisk:
 * ét board pr. ejer i praksis (det ældste), ingen status/afslutning.
 * TODO(ejer): board-livscyklus (hvornår slutter et board).
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

export interface BoardMember {
  partnerId: string;
  isLead: boolean;
  name: string;
  title: string | null;
  isInternal: boolean;
  shortBio: string | null;
  longBio: string | null;
  photoUrl: string | null;
  sortOrder: number;
  competenceTagIds: string[];
}

export interface OwnerBoard {
  id: string;
  name: string;
  members: BoardMember[];
}

interface ProfileEmbed {
  name: string;
  title: string | null;
  is_internal: boolean;
  short_bio: string | null;
  long_bio: string | null;
  photo_url: string | null;
  sort_order: number;
  partner_profile_competence_tag: Array<{ competence_tag_id: string }> | null;
}

interface MemberRow {
  partner_id: string;
  is_lead: boolean;
  /**
   * PostgREST returnerer en to-one-embed som ét objekt, men supabase-js' typeudledning gætter på
   * array når der ikke findes genererede DB-typer. Begge former accepteres og normaliseres i
   * rowToMember, så koden ikke afhænger af hvilket gæt der er rigtigt.
   */
  partner_profile: ProfileEmbed | ProfileEmbed[] | null;
}

interface BoardRow {
  id: string;
  name: string;
  board_partner: MemberRow[] | null;
}

// Én sammenhængende literal — se noten ved POOL_COLUMNS i src/server/matching.
const BOARD_COLUMNS =
  "id, name, board_partner(partner_id, is_lead, partner_profile(name, title, is_internal, short_bio, long_bio, photo_url, sort_order, partner_profile_competence_tag(competence_tag_id)))";

function rowToMember(row: MemberRow): BoardMember | null {
  const profile = Array.isArray(row.partner_profile) ? row.partner_profile[0] : row.partner_profile;
  if (!profile) return null;
  return {
    partnerId: row.partner_id,
    isLead: row.is_lead,
    name: profile.name,
    title: profile.title,
    isInternal: profile.is_internal,
    shortBio: profile.short_bio,
    longBio: profile.long_bio,
    photoUrl: profile.photo_url,
    sortOrder: profile.sort_order,
    competenceTagIds: (profile.partner_profile_competence_tag ?? []).map((t) => t.competence_tag_id),
  };
}

/** Den nuværende ejers board, eller null hvis hun endnu ikke har godkendt et. */
export async function getMyBoard(
  env: Record<string, string | undefined> = process.env,
): Promise<OwnerBoard | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("board")
    .select(BOARD_COLUMNS)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error(`[boards] getMyBoard fejlede: ${error.message}`);
    return null;
  }

  const row = data as unknown as BoardRow;
  const members = (row.board_partner ?? [])
    .map(rowToMember)
    .filter((member): member is BoardMember => member != null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "da"));

  return { id: row.id, name: row.name, members };
}
