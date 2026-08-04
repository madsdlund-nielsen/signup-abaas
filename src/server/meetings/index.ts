/**
 * Business-data-access for møder (Fase 2, ADR 0026). Læsning via den authed server-klient —
 * RLS afgør synligheden (meeting_select_owner/partner/admin, 0012), så SAMME funktioner virker
 * for både ejer og partner uden rolle-forgreninger her. Writes ligger i ./actions
 * (service-role bag rolle- + ejerskabstjek). Ukonfigureret Supabase → tom/null.
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

export type MeetingStatus = "planlagt" | "aflyst" | "afholdt";
export type MeetingRegisteredStatus = "afholdt" | "forsinket_afbud" | "udeblivelse";

export interface MeetingParticipant {
  partnerProfileId: string;
  name: string;
  /** Partnerens honorarregistrering (byggespec §5.6) — null indtil registreret. */
  registeredStatus: MeetingRegisteredStatus | null;
}

export interface Meeting {
  id: string;
  boardId: string;
  startsAt: string;
  durationMinutes: number;
  prepMinutes: number;
  status: MeetingStatus;
  videoJoinUrl: string | null;
  providerBookingUid: string | null;
  participants: MeetingParticipant[];
}

interface MeetingRow {
  id: string;
  board_id: string;
  starts_at: string;
  duration_minutes: number;
  prep_minutes: number;
  status: MeetingStatus;
  video_join_url: string | null;
  provider_booking_uid: string | null;
  meeting_partner:
    | Array<{
        partner_profile_id: string;
        registered_status: MeetingRegisteredStatus | null;
        partner_profile: { name: string } | Array<{ name: string }> | null;
      }>
    | null;
}

const MEETING_COLUMNS =
  "id, board_id, starts_at, duration_minutes, prep_minutes, status, video_join_url, provider_booking_uid, meeting_partner(partner_profile_id, registered_status, partner_profile(name))";

function rowToMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    boardId: row.board_id,
    startsAt: row.starts_at,
    durationMinutes: row.duration_minutes,
    prepMinutes: row.prep_minutes,
    status: row.status,
    videoJoinUrl: row.video_join_url,
    providerBookingUid: row.provider_booking_uid,
    participants: (row.meeting_partner ?? []).map((mp) => {
      const profile = Array.isArray(mp.partner_profile) ? mp.partner_profile[0] : mp.partner_profile;
      return {
        partnerProfileId: mp.partner_profile_id,
        name: profile?.name ?? "Ukendt partner",
        registeredStatus: mp.registered_status,
      };
    }),
  };
}

/** Alle møder den nuværende bruger må se (RLS scoper: ejer via board, partner via kobling). */
export async function listMyMeetings(
  env: Record<string, string | undefined> = process.env,
): Promise<Meeting[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("meeting")
    .select(MEETING_COLUMNS)
    .order("starts_at", { ascending: true });
  if (error) {
    console.error(`[meetings] listMyMeetings fejlede: ${error.message}`);
    return [];
  }
  return ((data ?? []) as unknown as MeetingRow[]).map(rowToMeeting);
}
