/**
 * Business-data-access for partner-kataloget (Fase 1.4, ADR 0019). Læsning via authed server-klient
 * (RLS: kun admin i 1.4). Admin-writes ligger i ./actions (service-role). Spejler src/server/tags +
 * quiz. Ukonfigureret Supabase → tom/null (kontofri CI/dev).
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

export interface PartnerProfile {
  id: string;
  name: string;
  title: string | null;
  isInternal: boolean;
  languages: string | null;
  personalInfo: string | null;
  shortBio: string | null;
  longBio: string | null;
  photoUrl: string | null;
  sortOrder: number;
}

export interface PartnerProfileDetail extends PartnerProfile {
  /** Kompetence-tags koblet af admin (autoritativt). 1.5 matching konsumerer dette. */
  competenceTagIds: string[];
}

interface PartnerRow {
  id: string;
  name: string;
  title: string | null;
  is_internal: boolean;
  languages: string | null;
  personal_info: string | null;
  short_bio: string | null;
  long_bio: string | null;
  photo_url: string | null;
  sort_order: number;
}

const PARTNER_COLUMNS =
  "id, name, title, is_internal, languages, personal_info, short_bio, long_bio, photo_url, sort_order";

function rowToPartner(row: PartnerRow): PartnerProfile {
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
    sortOrder: row.sort_order,
  };
}

export async function listPartners(
  env: Record<string, string | undefined> = process.env,
): Promise<PartnerProfile[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("partner_profile")
    .select(PARTNER_COLUMNS)
    .order("sort_order");
  if (error) {
    console.error(`[partners] listPartners fejlede: ${error.message}`);
    return [];
  }
  return ((data ?? []) as PartnerRow[]).map(rowToPartner);
}

export async function getPartner(
  id: string,
  env: Record<string, string | undefined> = process.env,
): Promise<PartnerProfileDetail | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("partner_profile")
    .select(`${PARTNER_COLUMNS}, partner_profile_competence_tag(competence_tag_id)`)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as PartnerRow & {
    partner_profile_competence_tag: Array<{ competence_tag_id: string }> | null;
  };
  return {
    ...rowToPartner(row),
    competenceTagIds: (row.partner_profile_competence_tag ?? []).map((t) => t.competence_tag_id),
  };
}
