/**
 * Business-data-access for mødevurderinger (Fase 4.2, ADR 0038). Læsning via den authed
 * server-klient — RLS (0015) afgør synligheden: man ser KUN de vurderinger man selv har
 * afgivet, og admin ser alle. Den vurderede partner ser dem ikke.
 *
 * Aggregeringen nedenfor er derfor i praksis en admin-funktion. Den er datagrundlag, ikke en
 * offentlig score (fase 4.2), og den må ikke kobles til board-matchingen: rating som
 * tie-break er stadig ejer-uafklaret (B-07). Ingen kaldere uden for /admin.
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";
import { summarise, type PartnerRatingSummary, type RatingSummaryRow } from "./summary";

export { summarise } from "./summary";
export type { PartnerRatingSummary, RatingSummaryRow } from "./summary";

export const RATING_MIN = 1;
export const RATING_MAX = 5;

export interface Rating {
  id: string;
  meetingId: string;
  /** Null = vurdering af mødet som helhed; sat = vurdering af den enkelte partner. */
  subjectPartnerProfileId: string | null;
  score: number;
  comment: string | null;
}

interface RatingRow {
  id: string;
  meeting_id: string;
  subject_partner_profile_id: string | null;
  score: number;
  comment: string | null;
}

const RATING_COLUMNS = "id, meeting_id, subject_partner_profile_id, score, comment";

/** De vurderinger den nuværende bruger selv har afgivet på et møde. */
export async function listMyRatingsForMeeting(
  meetingId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<Rating[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("meeting_rating")
    .select(RATING_COLUMNS)
    .eq("meeting_id", meetingId);
  if (error) {
    console.error(`[ratings] listMyRatingsForMeeting fejlede: ${error.message}`);
    return [];
  }
  return ((data ?? []) as unknown as RatingRow[]).map((row) => ({
    id: row.id,
    meetingId: row.meeting_id,
    subjectPartnerProfileId: row.subject_partner_profile_id,
    score: row.score,
    comment: row.comment,
  }));
}

/**
 * Aggregering pr. partner. RLS scoper rækkerne, så en ikke-admin får et tomt resultat frem
 * for en fejl — funktionen er ikke i sig selv et autorisationslag, og kaldstedet skal
 * stadig kræve admin. Selve aggregeringen ligger i ./summary — se dér for hvorfor den er
 * TypeScript og ikke SQL.
 */
export async function listPartnerRatingSummary(
  env: Record<string, string | undefined> = process.env,
): Promise<PartnerRatingSummary[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("meeting_rating")
    .select("subject_partner_profile_id, score, partner_profile:subject_partner_profile_id(name)")
    .not("subject_partner_profile_id", "is", null);
  if (error) {
    console.error(`[ratings] listPartnerRatingSummary fejlede: ${error.message}`);
    return [];
  }

  return summarise((data ?? []) as unknown as RatingSummaryRow[]);
}
