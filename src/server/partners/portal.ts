/**
 * Partner-portalens læsevej (Fase 2.8, ADR 0025). Authed klient — RLS-policyen
 * `partner_profile_select_self` (0011) scoper til `app_user_id = auth.uid()`, så der læses
 * aldrig andres profil. Boardet læses via `getMyBoard` (samme RLS-first-mønster: queryen har
 * intet ejer-filter, policies afgør synligheden — for en partner returnerer den partnerens board).
 * Ukonfigureret Supabase → null (kontofri CI/dev).
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

export interface MyPartnerProfile {
  id: string;
  name: string;
  title: string | null;
  isInternal: boolean;
  languages: string | null;
  personalInfo: string | null;
  shortBio: string | null;
  longBio: string | null;
  photoUrl: string | null;
  /** Tags er READ-ONLY for partneren (admin-styret, ADR 0019) — vises, redigeres ikke. */
  competenceTagIds: string[];
}

interface SelfRow {
  id: string;
  name: string;
  title: string | null;
  is_internal: boolean;
  languages: string | null;
  personal_info: string | null;
  short_bio: string | null;
  long_bio: string | null;
  photo_url: string | null;
  partner_profile_competence_tag: Array<{ competence_tag_id: string }> | null;
}

const SELF_COLUMNS =
  "id, name, title, is_internal, languages, personal_info, short_bio, long_bio, photo_url, partner_profile_competence_tag(competence_tag_id)";

/** Den nuværende partners egen katalogprofil, eller null (ikke partner / ikke koblet). */
export async function getMyPartnerProfile(
  env: Record<string, string | undefined> = process.env,
): Promise<MyPartnerProfile | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;

  const supabase = await createServerSupabase(config);
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return null;

  const { data, error } = await supabase
    .from("partner_profile")
    .select(SELF_COLUMNS)
    .eq("app_user_id", uid)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error(`[partners] getMyPartnerProfile fejlede: ${error.message}`);
    return null;
  }

  const row = data as unknown as SelfRow;
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    isInternal: row.is_internal,
    languages: row.languages,
    personalInfo: row.personal_info,
    shortBio: row.short_bio,
    longBio: row.long_bio,
    photoUrl: row.photo_url,
    competenceTagIds: (row.partner_profile_competence_tag ?? []).map((t) => t.competence_tag_id),
  };
}
