/**
 * Lageret bag rating-linkene (B-21, ADR 0060). Et interface, så servicelaget (`link-service.ts`)
 * kan testes uden database — samme greb som notifikationsmotorens `NotificationStore`
 * (ADR 0057). Supabase-implementeringen kører med service-role og er den ENESTE sti der
 * skriver til `rating_link`; selve engangsindløsningen er databasefunktionen
 * `redeem_rating_link` (0023), ikke kode her.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { LinkRater } from "./link";

/** En række i `rating_link` plus det minimum af mødet siden skal vise. */
export interface RatingLinkRecord {
  id: string;
  meetingId: string;
  rater: LinkRater;
  expiresAt: string;
  usedAt: string | null;
  meeting: {
    startsAt: string;
    status: string;
    boardName: string;
  } | null;
}

export interface CreateLinkInput {
  meetingId: string;
  rater: LinkRater;
  expiresAt: Date;
}

export interface RatingLinkStore {
  /** Find-eller-opret: ét link pr. (møde, rater). En gentaget kørsel får den eksisterende række. */
  getOrCreate(input: CreateLinkInput): Promise<RatingLinkRecord>;
  find(id: string): Promise<RatingLinkRecord | null>;
  /**
   * Indløs linket og gem vurderingen atomisk. Returnerer vurderingens id, eller `null` hvis
   * linket ikke (længere) kan bruges — brugt, udløbet, mødet ikke afholdt eller raten ikke
   * længere berettiget. Afgøres i basen.
   */
  redeem(id: string, score: number, comment: string | null): Promise<string | null>;
}

interface LinkRow {
  id: string;
  meeting_id: string;
  rater_user_id: string | null;
  rater_partner_profile_id: string | null;
  expires_at: string;
  used_at: string | null;
  meeting:
    | { starts_at: string; status: string; board: { name: string } | Array<{ name: string }> | null }
    | Array<{ starts_at: string; status: string; board: { name: string } | Array<{ name: string }> | null }>
    | null;
}

const LINK_SELECT =
  "id, meeting_id, rater_user_id, rater_partner_profile_id, expires_at, used_at, meeting(starts_at, status, board(name))";

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function toRecord(row: LinkRow): RatingLinkRecord | null {
  // Check-constrainten garanterer præcis én; en række der alligevel ikke har nogen er ødelagt.
  let rater: LinkRater;
  if (row.rater_user_id) rater = { kind: "user", userId: row.rater_user_id };
  else if (row.rater_partner_profile_id) {
    rater = { kind: "partner", partnerProfileId: row.rater_partner_profile_id };
  } else return null;

  const meeting = one(row.meeting);
  return {
    id: row.id,
    meetingId: row.meeting_id,
    rater,
    expiresAt: new Date(row.expires_at).toISOString(),
    usedAt: row.used_at,
    meeting: meeting
      ? {
          startsAt: meeting.starts_at,
          status: meeting.status,
          boardName: one(meeting.board)?.name ?? "",
        }
      : null,
  };
}

const UNIQUE_VIOLATION = "23505";

export function createSupabaseRatingLinkStore(service: SupabaseClient): RatingLinkStore {
  async function findByRater(meetingId: string, rater: LinkRater): Promise<RatingLinkRecord | null> {
    const query = service.from("rating_link").select(LINK_SELECT).eq("meeting_id", meetingId);
    const { data, error } =
      rater.kind === "user"
        ? await query.eq("rater_user_id", rater.userId).maybeSingle()
        : await query.eq("rater_partner_profile_id", rater.partnerProfileId).maybeSingle();
    if (error) throw new Error(`Kunne ikke læse rating-linket: ${error.message}`);
    return data ? toRecord(data as unknown as LinkRow) : null;
  }

  return {
    async getOrCreate({ meetingId, rater, expiresAt }) {
      const existing = await findByRater(meetingId, rater);
      if (existing) return existing;

      const { error } = await service.from("rating_link").insert({
        meeting_id: meetingId,
        rater_user_id: rater.kind === "user" ? rater.userId : null,
        rater_partner_profile_id: rater.kind === "partner" ? rater.partnerProfileId : null,
        expires_at: expiresAt.toISOString(),
      });
      // En samtidig kørsel nåede først: den unikke constraint er værnet, vi læser blot rækken.
      if (error && error.code !== UNIQUE_VIOLATION) {
        throw new Error(`Kunne ikke oprette rating-linket: ${error.message}`);
      }
      const created = await findByRater(meetingId, rater);
      if (!created) throw new Error("Rating-linket kunne ikke læses efter oprettelsen.");
      return created;
    },

    async find(id) {
      const { data, error } = await service.from("rating_link").select(LINK_SELECT).eq("id", id).maybeSingle();
      if (error) throw new Error(`Kunne ikke læse rating-linket: ${error.message}`);
      return data ? toRecord(data as unknown as LinkRow) : null;
    },

    async redeem(id, score, comment) {
      const { data, error } = await service.rpc("redeem_rating_link", {
        p_link_id: id,
        p_score: score,
        p_comment: comment,
      });
      if (error) throw new Error(`Kunne ikke indløse rating-linket: ${error.message}`);
      return typeof data === "string" ? data : null;
    },
  };
}
