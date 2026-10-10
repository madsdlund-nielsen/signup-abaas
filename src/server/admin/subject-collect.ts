/**
 * Indsigtsudtræk — indsamling (fase 5.5, ADR 0053).
 *
 * Henter de rå rækker om ÉN person og afleverer dem til `composeSubjectAccessExport`.
 * Al adgang til databasen går gennem en `RowFetcher`, så indsamlingens rækkefølge og nøgler
 * kan afprøves med en fælles in-memory-fetcher uden Supabase. Produktions-fetcheren
 * (`supabaseRowFetcher`) bruger service-role og må KUN konstrueres bag et admin-tjek —
 * det sker i route handleren, aldrig her.
 *
 * Persondata-hygiejne: fejlbeskeder nævner tabel og database-fejl, aldrig filterværdier
 * (e-mail, id'er). Intet logges herfra.
 *
 * Rækkegrænsen fejler højlydt: rammer en tabel PostgREST' 1000 rækker for én person, kaster vi
 * i stedet for at aflevere et udtræk der stille mangler data. Et juridisk udtræk må ikke være
 * afkortet uden at vide det.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AgendaItemRow,
  AppUserRow,
  BoardPartnerRow,
  BoardRow,
  ChargeRow,
  CompetenceTagRow,
  MeetingNoteRow,
  MeetingPartnerRow,
  MeetingRow,
  MembershipRow,
  PartnerProfileRow,
  PartnerTagLinkRow,
  PrepNoteRow,
  QuizAnswerRow,
  QuizOptionRow,
  QuizQuestionRow,
  RatingRow,
  RawSubjectData,
  RoleRow,
} from "./subject-access";

export const SUBJECT_ROW_LIMIT = 1000;

export interface RowQuery {
  table: string;
  columns: string;
  /** Præcis match på én kolonne. */
  eq?: { column: string; value: string };
  /** Kolonnen skal være i listen. Tom liste → ingen rækker (undgår en ufiltreret læsning). */
  in?: { column: string; values: readonly string[] };
}

export type RowFetcher = (query: RowQuery) => Promise<Record<string, unknown>[]>;

export class SubjectExportTooLargeError extends Error {
  constructor(table: string) {
    super(`Udtrækket er for stort til at hente sikkert: ${table} nåede rækkegrænsen.`);
    this.name = "SubjectExportTooLargeError";
  }
}

/** Fetcher bag service-role-klienten. Konstruér kun efter et admin-tjek. */
export function supabaseRowFetcher(service: SupabaseClient): RowFetcher {
  return async (query) => {
    if (query.in && query.in.values.length === 0) return [];

    let builder = service.from(query.table).select(query.columns);
    if (query.eq) builder = builder.eq(query.eq.column, query.eq.value);
    if (query.in) builder = builder.in(query.in.column, [...query.in.values]);

    const { data, error } = await builder.limit(SUBJECT_ROW_LIMIT);
    if (error) throw new Error(`Læsning af ${query.table} fejlede: ${error.message}`);
    const list = (data ?? []) as unknown as Record<string, unknown>[];
    if (list.length >= SUBJECT_ROW_LIMIT) throw new SubjectExportTooLargeError(query.table);
    return list;
  };
}

/** Slå dubletter sammen (en person kan være både ejer og partner på samme møde). */
function dedupe<T>(list: readonly T[], key: (item: T) => string): T[] {
  return [...new Map(list.map((item) => [key(item), item])).values()];
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string"))];
}

/**
 * Saml de rå rækker om personen bag `email`. `null` hvis ingen konto har den adresse.
 * Alle rækker hentes for personens egne nøgler (bruger-id, partner-profil-id, board-id'er) —
 * aldrig ved at filtrere en stor tabel bagefter.
 */
export async function collectSubjectData(
  fetchRows: RowFetcher,
  email: string,
): Promise<RawSubjectData | null> {
  const get = async <T>(query: RowQuery): Promise<T[]> => (await fetchRows(query)) as unknown as T[];

  const [user] = await get<AppUserRow>({
    table: "app_user",
    columns: "id, email, created_at",
    eq: { column: "email", value: email },
  });
  if (!user) return null;

  // Trin 1: alt der hænger direkte på brugeren.
  const [roles, ownedBoards, profiles, quizAnswers, userRatings] = await Promise.all([
    get<RoleRow>({ table: "user_role_assignment", columns: "role", eq: { column: "user_id", value: user.id } }),
    get<BoardRow>({
      table: "board",
      columns: "id, owner_id, name, created_at",
      eq: { column: "owner_id", value: user.id },
    }),
    get<PartnerProfileRow>({
      table: "partner_profile",
      columns:
        "id, name, title, is_internal, languages, personal_info, short_bio, long_bio, photo_url, app_user_id, created_at, updated_at",
      eq: { column: "app_user_id", value: user.id },
    }),
    get<QuizAnswerRow>({
      table: "quiz_answer",
      columns: "quiz_option_id, free_text, created_at",
      eq: { column: "owner_id", value: user.id },
    }),
    get<RatingRow>({
      table: "meeting_rating",
      columns:
        "id, meeting_id, rater_user_id, rater_partner_profile_id, subject_partner_profile_id, score, comment, created_at",
      eq: { column: "rater_user_id", value: user.id },
    }),
  ]);
  const partnerProfile = profiles[0] ?? null;
  const ownedBoardIds = ownedBoards.map((b) => b.id);

  // Trin 2: det der hænger på personens boards, partner-profil og quizsvar.
  const [
    ownedBoardPartners,
    memberLinks,
    memberships,
    ownedMeetings,
    partnerMeetingRows,
    partnerRatings,
    ownNotes,
    ownPrepNotes,
    tagLinks,
    quizOptions,
  ] = await Promise.all([
    get<BoardPartnerRow>({
      table: "board_partner",
      columns: "board_id, partner_id, is_lead",
      in: { column: "board_id", values: ownedBoardIds },
    }),
    partnerProfile
      ? get<BoardPartnerRow>({
          table: "board_partner",
          columns: "board_id, partner_id, is_lead",
          eq: { column: "partner_id", value: partnerProfile.id },
        })
      : Promise.resolve([] as BoardPartnerRow[]),
    get<MembershipRow>({
      table: "membership",
      columns:
        "id, board_id, frequency_weeks, status, provider, provider_customer_ref, card_status, created_at",
      in: { column: "board_id", values: ownedBoardIds },
    }),
    get<MeetingRow>({
      table: "meeting",
      columns:
        "id, board_id, provider, provider_booking_uid, starts_at, duration_minutes, prep_minutes, status, video_join_url, created_at",
      in: { column: "board_id", values: ownedBoardIds },
    }),
    partnerProfile
      ? get<MeetingPartnerRow>({
          table: "meeting_partner",
          columns: "meeting_id, partner_profile_id, registered_status, registered_at",
          eq: { column: "partner_profile_id", value: partnerProfile.id },
        })
      : Promise.resolve([] as MeetingPartnerRow[]),
    partnerProfile
      ? get<RatingRow>({
          table: "meeting_rating",
          columns:
            "id, meeting_id, rater_user_id, rater_partner_profile_id, subject_partner_profile_id, score, comment, created_at",
          eq: { column: "rater_partner_profile_id", value: partnerProfile.id },
        })
      : Promise.resolve([] as RatingRow[]),
    partnerProfile
      ? get<MeetingNoteRow>({
          table: "meeting_note",
          columns: "id, meeting_id, partner_profile_id, body, created_at",
          eq: { column: "partner_profile_id", value: partnerProfile.id },
        })
      : Promise.resolve([] as MeetingNoteRow[]),
    partnerProfile
      ? get<PrepNoteRow>({
          table: "meeting_prep_note",
          columns: "id, meeting_id, partner_profile_id, body, created_at, updated_at",
          eq: { column: "partner_profile_id", value: partnerProfile.id },
        })
      : Promise.resolve([] as PrepNoteRow[]),
    partnerProfile
      ? get<PartnerTagLinkRow>({
          table: "partner_profile_competence_tag",
          columns: "partner_profile_id, competence_tag_id",
          eq: { column: "partner_profile_id", value: partnerProfile.id },
        })
      : Promise.resolve([] as PartnerTagLinkRow[]),
    get<QuizOptionRow>({
      table: "quiz_option",
      columns: "id, quiz_question_id, label",
      in: { column: "id", values: unique(quizAnswers.map((a) => a.quiz_option_id)) },
    }),
  ]);

  const ownedMeetingIds = ownedMeetings.map((m) => m.id);
  const membershipIds = memberships.map((m) => m.id);
  const memberBoardIds = unique(memberLinks.map((l) => l.board_id));

  // Trin 3: møder, noter, betalinger og navne der peger videre fra trin 2.
  const [
    memberBoards,
    charges,
    ownedMeetingPartners,
    ownedMeetingNotes,
    agendaItems,
    quizQuestions,
    competenceTags,
  ] = await Promise.all([
    get<Pick<BoardRow, "id" | "name">>({
      table: "board",
      columns: "id, name",
      in: { column: "id", values: memberBoardIds },
    }),
    get<ChargeRow>({
      table: "payment_charge",
      columns:
        "id, meeting_id, membership_id, amount_minor, currency, status, failure_reason, provider_charge_ref, provider_invoice_ref, created_at",
      in: { column: "membership_id", values: membershipIds },
    }),
    get<MeetingPartnerRow>({
      table: "meeting_partner",
      columns: "meeting_id, partner_profile_id, registered_status, registered_at",
      in: { column: "meeting_id", values: ownedMeetingIds },
    }),
    get<MeetingNoteRow>({
      table: "meeting_note",
      columns: "id, meeting_id, partner_profile_id, body, created_at",
      in: { column: "meeting_id", values: ownedMeetingIds },
    }),
    get<AgendaItemRow>({
      table: "meeting_agenda_item",
      columns: "id, meeting_id, kind, body, sort_order",
      in: { column: "meeting_id", values: ownedMeetingIds },
    }),
    get<QuizQuestionRow>({
      table: "quiz_question",
      columns: "id, prompt",
      in: { column: "id", values: unique(quizOptions.map((o) => o.quiz_question_id)) },
    }),
    get<CompetenceTagRow>({
      table: "competence_tag",
      columns: "id, label",
      in: { column: "id", values: unique(tagLinks.map((l) => l.competence_tag_id)) },
    }),
  ]);

  // Møder personen deltog i som partner — hent selve møderækkerne (starttid/status).
  const partnerMeetingIds = unique(partnerMeetingRows.map((mp) => mp.meeting_id)).filter(
    (id) => !ownedMeetingIds.includes(id),
  );
  const partnerMeetings = await get<MeetingRow>({
    table: "meeting",
    columns:
      "id, board_id, provider, provider_booking_uid, starts_at, duration_minutes, prep_minutes, status, video_join_url, created_at",
    in: { column: "id", values: partnerMeetingIds },
  });

  // Navne på de partnere der optræder (rådgivere på ejerens boards, deltagere, noteforfattere,
  // vurderede partnere). Kun id + navn hentes — aldrig en andens profil i fuld bredde.
  const boardPartners = dedupe([...ownedBoardPartners, ...memberLinks], (bp) => `${bp.board_id}:${bp.partner_id}`);
  const nameIds = unique([
    ...boardPartners.map((bp) => bp.partner_id),
    ...ownedMeetingPartners.map((mp) => mp.partner_profile_id),
    ...ownedMeetingNotes.map((n) => n.partner_profile_id),
    ...userRatings.map((r) => r.subject_partner_profile_id),
    ...partnerRatings.map((r) => r.subject_partner_profile_id),
  ]);
  const partnerNames = await get<Pick<PartnerProfileRow, "id" | "name">>({
    table: "partner_profile",
    columns: "id, name",
    in: { column: "id", values: nameIds },
  });

  return {
    user,
    roles,
    ownedBoards,
    partnerProfile,
    memberBoards,
    boardPartners,
    partnerNames,
    competenceTags,
    partnerTagLinks: tagLinks,
    memberships,
    charges,
    meetings: dedupe([...ownedMeetings, ...partnerMeetings], (m) => m.id),
    meetingPartners: dedupe(
      [...ownedMeetingPartners, ...partnerMeetingRows],
      (mp) => `${mp.meeting_id}:${mp.partner_profile_id}`,
    ),
    meetingNotes: dedupe([...ownedMeetingNotes, ...ownNotes], (n) => n.id),
    prepNotes: ownPrepNotes,
    agendaItems,
    ratingsGiven: dedupe([...userRatings, ...partnerRatings], (r) => r.id),
    quizAnswers,
    quizOptions,
    quizQuestions,
  };
}
