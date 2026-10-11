/**
 * Sletteplan (GDPR art. 17, ADR 0068) — modstykket til indsigtsudtrækket (ADR 0053).
 *
 * `planErasure` LÆSER alt der hænger på én person og beregner, uden at skrive noget:
 *   - hvad der slettes i Supabase (og hvad der kun anonymiseres),
 *   - hvad der BLOKERER sletningen: opbevaringspligt (🔴 ejer/jura — fail-closed, se nedenfor),
 *     boards hvor fjernelsen af en partner bryder invarianterne (B-68), og et par driftsværn,
 *   - planen for hvert board partneren skal fjernes fra (fødes videre til `erase_data_subject`),
 *   - hvilke eksterne behandlere der skal have besked, og hvad der må slettes manuelt.
 *
 * Opdelingen er den samme som i indsigtsudtrækket: `readErasureFacts` taler med databasen gennem en
 * `RowFetcher` (så den kan afprøves mod en in-memory-fetcher), `computeErasurePlan` er ren.
 *
 * FAIL-CLOSED på opbevaringspligt: hvad der er bogføringsbærende er ikke afgjort (TODO(ejer/jura):
 * opbevaringsperioder; docs/gdpr/sletteflow.md). Derfor bygger vi ikke en regel — vi nægter at
 * slette en person med medlemskab/betalingstræk på et board vedkommende ejer, og en person
 * (ejer OG partner) hvis møder bærer et registreret honorargrundlag. Funktionen i migration 0028
 * gentager tjekket som sidste værn.
 *
 * Persondata-hygiejne: planen bærer id'er, optællinger og boardnavne — aldrig e-mail, telefon eller
 * navn på personen selv. Fejlbeskeder nævner tabel, aldrig filterværdier.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { SubjectExportTooLargeError, supabaseRowFetcher, type RowFetcher, type RowQuery } from "@/server/admin/subject-collect";
import { planBoardChange, type MemberRow } from "@/server/boards/composition";

export type ExternalProcessor = "posthog" | "resend" | "calcom" | "inmobile" | "ordbogen";

export type BlockerCode =
  | "opbevaringspligt-betaling"
  | "opbevaringspligt-honorar"
  | "board-invariant"
  | "selv"
  | "sidste-admin";

export interface BlockedBoard {
  id: string;
  name: string;
  /** Hvilken regel fjernelsen bryder (dansk, fra sammensætningsreglerne). */
  reason: string;
}

export interface ErasureBlocker {
  code: BlockerCode;
  message: string;
  /** Kun for `board-invariant`: de boards admin skal rette først. */
  boards?: BlockedBoard[];
}

export interface PlannedDeletion {
  label: string;
  count: number;
  /** `slettes` fjerner rækkerne; `anonymiseres` bevarer dem uden personen (aktør nulstilles). */
  kind: "slettes" | "anonymiseres";
}

export interface PlannedExternal {
  processor: ExternalProcessor;
  label: string;
  /** Hvad vi gør automatisk via porten. Null = ingen automatisk sletning findes (manuelt punkt). */
  automatic: string | null;
  /** Hvad der må ske manuelt hos behandleren. Null = intet. */
  manual: string | null;
  /**
   * Er det manuelle punkt et reelt hul (data ligger tilbage hos behandleren, og ingen automatik
   * findes)? Så står behandleren som «mangler» på kvitteringen. Falsk = en note (fx mailloggens
   * retention hos Resend), som ikke gør sletningen ufuldstændig.
   */
  manualIsGap: boolean;
}

/** Planen for ét board partneren fjernes fra — formen `erase_data_subject` forventer (0028). */
export interface BoardRemoval {
  boardId: string;
  boardName: string;
  expectedPartnerIds: string[];
  partnerId: string;
  /** Lead efter fjernelsen (lead-reglen bor i `planBoardChange`, TODO(ejer): lead-partner regler). */
  leadId: string | null;
}

export interface ErasurePlan {
  userId: string;
  roles: string[];
  /** Til skærmen: kontoens visningsnavn hvis der er et. Aldrig e-mail eller telefon. */
  displayName: string | null;
  hasPartnerProfile: boolean;
  deletions: PlannedDeletion[];
  boardRemovals: BoardRemoval[];
  /** Cal.com-uid'er på kommende, planlagte møder på personens boards (aflyses efter Supabase-sletningen). */
  upcomingBookingUids: string[];
  /** Har personen møder med en Cal.com-booking (attendee-data hos leverandøren)? */
  hasBookings: boolean;
  blockers: ErasureBlocker[];
  externals: PlannedExternal[];
  /** Ingen blokeringer. (Skærmen og handlingen nægter at udføre en plan hvor dette er falsk.) */
  executable: boolean;
}

/** De rå rækker planen bygges af. */
export interface ErasureFacts {
  user: { id: string; displayName: string | null; hasPhone: boolean };
  actorId: string;
  roles: string[];
  otherAdminCount: number;
  ownedBoards: Array<{ id: string; name: string }>;
  memberships: number;
  charges: number;
  ownedMeetings: Array<{ id: string; status: string; startsAt: string; bookingUid: string | null }>;
  /** `meeting_partner`-rækker med en registrering (honorargrundlag) på personens boards. */
  ownedRegisteredPartners: number;
  ownedNotes: number;
  ownedAgendaItems: number;
  ownedPrepNotes: number;
  ownedSummaries: number;
  ownedMeetingRatings: number;
  quizAnswers: number;
  ratingsGiven: number;
  ratingLinks: number;
  deliveries: number;
  boardChangesAsActor: number;
  profile: {
    id: string;
    calcomUserId: number | null;
    /** De boards partneren sidder på (uden de boards personen selv ejer). */
    boards: Array<{ id: string; name: string; ownedBySubject: boolean }>;
    members: Array<{ board_id: string; partner_id: string; is_lead: boolean }>;
    internalById: Record<string, boolean>;
    meetings: number;
    registeredMeetings: number;
    notes: number;
    prepNotes: number;
    availability: number;
    absences: number;
    ratingsGiven: number;
    ratingsAbout: number;
    ratingLinks: number;
    tags: number;
  } | null;
  now: Date;
}

export const MISSING_APP_USER = "Personen findes ikke.";

type Row = Record<string, unknown>;

function str(row: Row, key: string): string {
  return String(row[key] ?? "");
}

/** Læs de rå fakta om personen. Kaster hvis personen ikke findes; skriver ingenting. */
export async function readErasureFacts(
  fetchRows: RowFetcher,
  userId: string,
  actorId: string,
  now: Date,
): Promise<ErasureFacts> {
  const get = (query: RowQuery): Promise<Row[]> => fetchRows(query);
  const count = async (query: RowQuery): Promise<number> => (await get(query)).length;
  const byUser = (table: string, column: string): Promise<number> =>
    count({ table, columns: "id", eq: { column, value: userId } });

  const [user] = await get({
    table: "app_user",
    columns: "id, display_name, phone_e164",
    eq: { column: "id", value: userId },
  });
  if (!user) throw new Error(MISSING_APP_USER);

  const [roleRows, adminRows, boardRows, profileRows] = await Promise.all([
    get({ table: "user_role_assignment", columns: "role", eq: { column: "user_id", value: userId } }),
    get({ table: "user_role_assignment", columns: "user_id", eq: { column: "role", value: "admin" } }),
    get({ table: "board", columns: "id, name", eq: { column: "owner_id", value: userId } }),
    get({ table: "partner_profile", columns: "id, calcom_user_id", eq: { column: "app_user_id", value: userId } }),
  ]);
  const boardIds = boardRows.map((b) => str(b, "id"));
  const profileRow = profileRows[0];
  const profileId = profileRow ? str(profileRow, "id") : null;

  const inBoards = (table: string, columns: string): Promise<Row[]> =>
    get({ table, columns, in: { column: "board_id", values: boardIds } });

  const [membershipRows, meetingRows, quizAnswers, ratingsGiven, deliveries, ratingLinks, actorChanges] =
    await Promise.all([
      inBoards("membership", "id"),
      inBoards("meeting", "id, status, starts_at, provider_booking_uid"),
      byUser("quiz_answer", "owner_id"),
      byUser("meeting_rating", "rater_user_id"),
      byUser("notification_delivery", "recipient_user_id"),
      byUser("rating_link", "rater_user_id"),
      byUser("board_change", "actor_id"),
    ]);
  const meetingIds = meetingRows.map((m) => str(m, "id"));
  const inMeetings = (table: string, columns: string): Promise<Row[]> =>
    get({ table, columns, in: { column: "meeting_id", values: meetingIds } });

  const [chargeRows, ownedPartnerRows, notes, agenda, prep, summaries, meetingRatings] = await Promise.all([
    get({ table: "payment_charge", columns: "id", in: { column: "membership_id", values: membershipRows.map((m) => str(m, "id")) } }),
    inMeetings("meeting_partner", "meeting_id, registered_status"),
    inMeetings("meeting_note", "id"),
    inMeetings("meeting_agenda_item", "id"),
    inMeetings("meeting_prep_note", "id"),
    inMeetings("meeting_summary", "id"),
    inMeetings("meeting_rating", "id"),
  ]);

  let profile: ErasureFacts["profile"] = null;
  if (profileRow && profileId) {
    const forPartner = (table: string, column = "partner_profile_id"): Promise<number> =>
      count({ table, columns: "id", eq: { column, value: profileId } });

    const links = await get({ table: "board_partner", columns: "board_id, partner_id, is_lead", eq: { column: "partner_id", value: profileId } });
    const linkBoardIds = links.map((l) => str(l, "board_id"));
    const [linkedBoards, members, partnerMeetings, tagRows] = await Promise.all([
      get({ table: "board", columns: "id, name, owner_id", in: { column: "id", values: linkBoardIds } }),
      get({ table: "board_partner", columns: "board_id, partner_id, is_lead", in: { column: "board_id", values: linkBoardIds } }),
      get({ table: "meeting_partner", columns: "meeting_id, registered_status", eq: { column: "partner_profile_id", value: profileId } }),
      get({ table: "partner_profile_competence_tag", columns: "competence_tag_id", eq: { column: "partner_profile_id", value: profileId } }),
    ]);
    const memberProfileIds = [...new Set(members.map((m) => str(m, "partner_id")))];
    const [internalRows, noteCount, prepCount, availability, absences, partnerRatingsGiven, ratingsAbout, partnerLinks] =
      await Promise.all([
        get({ table: "partner_profile", columns: "id, is_internal", in: { column: "id", values: memberProfileIds } }),
        forPartner("meeting_note"),
        forPartner("meeting_prep_note"),
        forPartner("partner_availability"),
        forPartner("partner_absence"),
        forPartner("meeting_rating", "rater_partner_profile_id"),
        forPartner("meeting_rating", "subject_partner_profile_id"),
        forPartner("rating_link", "rater_partner_profile_id"),
      ]);

    profile = {
      id: profileId,
      calcomUserId: typeof profileRow.calcom_user_id === "number" ? profileRow.calcom_user_id : null,
      boards: linkedBoards.map((b) => ({
        id: str(b, "id"),
        name: str(b, "name"),
        ownedBySubject: str(b, "owner_id") === userId,
      })),
      members: members.map((m) => ({
        board_id: str(m, "board_id"),
        partner_id: str(m, "partner_id"),
        is_lead: m.is_lead === true,
      })),
      internalById: Object.fromEntries(internalRows.map((p) => [str(p, "id"), p.is_internal === true])),
      meetings: partnerMeetings.length,
      registeredMeetings: partnerMeetings.filter((m) => m.registered_status != null).length,
      notes: noteCount,
      prepNotes: prepCount,
      availability,
      absences,
      ratingsGiven: partnerRatingsGiven,
      ratingsAbout,
      ratingLinks: partnerLinks,
      tags: tagRows.length,
    };
  }

  return {
    user: {
      id: userId,
      displayName: typeof user.display_name === "string" ? user.display_name : null,
      hasPhone: typeof user.phone_e164 === "string" && user.phone_e164.length > 0,
    },
    actorId,
    roles: roleRows.map((r) => str(r, "role")),
    otherAdminCount: adminRows.filter((r) => str(r, "user_id") !== userId).length,
    ownedBoards: boardRows.map((b) => ({ id: str(b, "id"), name: str(b, "name") })),
    memberships: membershipRows.length,
    charges: chargeRows.length,
    ownedMeetings: meetingRows.map((m) => ({
      id: str(m, "id"),
      status: str(m, "status"),
      startsAt: str(m, "starts_at"),
      bookingUid: typeof m.provider_booking_uid === "string" ? m.provider_booking_uid : null,
    })),
    ownedRegisteredPartners: ownedPartnerRows.filter((r) => r.registered_status != null).length,
    ownedNotes: notes.length,
    ownedAgendaItems: agenda.length,
    ownedPrepNotes: prep.length,
    ownedSummaries: summaries.length,
    ownedMeetingRatings: meetingRatings.length,
    quizAnswers,
    ratingsGiven,
    ratingLinks,
    deliveries,
    boardChangesAsActor: actorChanges,
    profile,
    now,
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Ren beregning over de læste fakta. */
export function computeErasurePlan(facts: ErasureFacts): ErasurePlan {
  const { profile } = facts;
  const blockers: ErasureBlocker[] = [];

  // --- Driftsværn --------------------------------------------------------------------------
  if (facts.user.id === facts.actorId) {
    blockers.push({ code: "selv", message: "En admin kan ikke slette sin egen konto. Bed en anden admin om det." });
  }
  if (facts.roles.includes("admin") && facts.otherAdminCount === 0) {
    blockers.push({
      code: "sidste-admin",
      message: "Personen er den sidste admin. Giv en anden admin-rollen først, ellers kan ingen administrere platformen.",
    });
  }

  // --- Opbevaringspligt (🔴 ejer/jura) — fail-closed ------------------------------------------
  // TODO(ejer/jura): opbevaringspligt. Indtil bogførings- og betalingsdata er afklaret, kan en person
  // med betalingsdata ikke slettes af flowet.
  if (facts.memberships > 0 || facts.charges > 0) {
    blockers.push({
      code: "opbevaringspligt-betaling",
      message:
        `Afventer afklaring af opbevaringspligt (TODO(ejer/jura)): personen ejer et board med betalingsdata ` +
        `(${plural(facts.memberships, "medlemskab", "medlemskaber")}, ${plural(facts.charges, "betalingstræk", "betalingstræk")}). ` +
        `Bogførings- og betalingsdata kan være underlagt lovpligtig opbevaring, og sletningen er ikke afklaret.`,
    });
  }
  const registered = facts.ownedRegisteredPartners + (profile?.registeredMeetings ?? 0);
  if (registered > 0) {
    blockers.push({
      code: "opbevaringspligt-honorar",
      message:
        `Afventer afklaring af opbevaringspligt (TODO(ejer/jura)): ${plural(registered, "møde", "møder")} bærer et registreret ` +
        `honorargrundlag (partnerens afholdt/afbud/udeblivelse). Honorar er bogføringsbærende, og en sletning ville fjerne grundlaget.`,
    });
  }

  // --- Partner: fjernelse fra boards (B-68) ---------------------------------------------------
  const boardRemovals: BoardRemoval[] = [];
  const blockedBoards: BlockedBoard[] = [];
  if (profile) {
    for (const board of profile.boards) {
      // Et board personen selv ejer slettes helt — der er ingen sammensætning at holde.
      if (board.ownedBySubject) continue;
      const rows: MemberRow[] = profile.members
        .filter((m) => m.board_id === board.id)
        .map((m) => ({ partner_id: m.partner_id, is_lead: m.is_lead }));
      try {
        const plan = planBoardChange(
          rows,
          { kind: "fjern", partnerId: profile.id },
          new Map(Object.entries(profile.internalById)),
        );
        boardRemovals.push({
          boardId: board.id,
          boardName: board.name,
          expectedPartnerIds: rows.map((r) => r.partner_id),
          partnerId: profile.id,
          leadId: plan.leadId,
        });
      } catch (e) {
        blockedBoards.push({ id: board.id, name: board.name, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    if (blockedBoards.length > 0) {
      blockers.push({
        code: "board-invariant",
        message:
          `Partneren kan ikke fjernes uden at bryde reglerne for ${plural(blockedBoards.length, "board", "boards")} ` +
          `(2-3 partnere, mindst én intern, præcis én lead). Udskift partneren på boardet først (admin → Boards), og prøv igen (B-68).`,
        boards: blockedBoards,
      });
    }
  }

  // --- Hvad der slettes -------------------------------------------------------------------------
  const deletions: PlannedDeletion[] = [
    { label: "Konto: login, e-mail, navn, telefon og tidszone", count: 1, kind: "slettes" },
    { label: "Roller", count: facts.roles.length, kind: "slettes" },
    { label: "Kvizsvar", count: facts.quizAnswers, kind: "slettes" },
    { label: "Vurderinger afgivet som ejer", count: facts.ratingsGiven, kind: "slettes" },
    { label: "Vurderingslinks", count: facts.ratingLinks + (profile?.ratingLinks ?? 0), kind: "slettes" },
    { label: "Udsendelseslog (beskeder sendt til personen)", count: facts.deliveries, kind: "slettes" },
  ];
  if (facts.ownedBoards.length > 0) {
    deletions.push(
      { label: "Boards personen ejer", count: facts.ownedBoards.length, kind: "slettes" },
      { label: "Møder på de boards", count: facts.ownedMeetings.length, kind: "slettes" },
      { label: "Mødenoter og forberedelsesnoter på de møder", count: facts.ownedNotes + facts.ownedPrepNotes, kind: "slettes" },
      { label: "Dagsordener og spørgsmål på de møder", count: facts.ownedAgendaItems, kind: "slettes" },
      { label: "AI-resuméer af de møder", count: facts.ownedSummaries, kind: "slettes" },
      { label: "Vurderinger på de møder (fra alle deltagere)", count: facts.ownedMeetingRatings, kind: "slettes" },
    );
  }
  if (profile) {
    deletions.push(
      { label: "Partnerprofil (katalogpost: navn, bio, billede, personlig info)", count: 1, kind: "slettes" },
      { label: "Kompetence-tags på profilen", count: profile.tags, kind: "slettes" },
      { label: "Boardmedlemskaber (fjernes via sammensætningen, med spor)", count: boardRemovals.length, kind: "slettes" },
      { label: "Møder partneren deltog i (deltagerrækker)", count: profile.meetings, kind: "slettes" },
      { label: "Mødenoter og forberedelsesnoter skrevet af partneren", count: profile.notes + profile.prepNotes, kind: "slettes" },
      { label: "Tilgængelighed og fravær (fraværsnoter kan være helbredsoplysninger)", count: profile.availability + profile.absences, kind: "slettes" },
      { label: "Vurderinger afgivet som partner", count: profile.ratingsGiven, kind: "slettes" },
      { label: "Modtagne vurderinger om partneren", count: profile.ratingsAbout, kind: "slettes" },
    );
  }
  deletions.push({
    label: "Board-ændringsspor hvor personen var aktør (aktør nulstilles, rækken består anonymt)",
    count: facts.boardChangesAsActor,
    kind: "anonymiseres",
  });

  // --- Eksterne behandlere --------------------------------------------------------------------
  const nowMs = facts.now.getTime();
  const upcomingBookingUids = facts.ownedMeetings
    .filter((m) => m.status === "planlagt" && m.bookingUid && new Date(m.startsAt).getTime() > nowMs)
    .map((m) => m.bookingUid as string);
  const hasBookings = facts.ownedMeetings.some((m) => m.bookingUid);

  const externals: PlannedExternal[] = [
    {
      processor: "posthog",
      label: "PostHog (analytics, EU)",
      automatic: "Person, hændelser og optagelser slettes (distinct-id = bruger-id).",
      manual: null,
      manualIsGap: false,
    },
    {
      processor: "resend",
      label: "Resend (e-mail, EU)",
      automatic: "Kontakt slettes (nøgle: e-mailadressen).",
      manual: "Sendte mails ligger i Resends maillog efter leverandørens retention — der er ingen API til at slette dem.",
      manualIsGap: false,
    },
  ];
  const calcomAutomatic = [
    boardRemovals.length > 0 ? `Fjernes som vært på ${plural(boardRemovals.length, "board", "boards")}s event type.` : null,
    upcomingBookingUids.length > 0 ? `${plural(upcomingBookingUids.length, "kommende booking", "kommende bookinger")} aflyses.` : null,
  ].filter((s): s is string => s !== null);
  const calcomManual = [
    hasBookings ? "Ejeren er attendee på bookingerne (navn, e-mail, tidszone) — attendee-data på tidligere bookinger slettes manuelt hos Cal.com." : null,
    profile?.calcomUserId != null ? "Partnerens Cal.com-sæde (team-medlem) frigives manuelt — der er ingen verificeret API til det." : null,
  ].filter((s): s is string => s !== null);
  if (calcomAutomatic.length > 0 || calcomManual.length > 0) {
    externals.push({
      processor: "calcom",
      label: "Cal.com (booking og video)",
      automatic: calcomAutomatic.length > 0 ? calcomAutomatic.join(" ") : null,
      manual: calcomManual.length > 0 ? calcomManual.join(" ") : null,
      manualIsGap: calcomManual.length > 0,
    });
  }
  if (facts.user.hasPhone) {
    externals.push({
      processor: "inmobile",
      label: "inMobile (SMS)",
      automatic: null,
      manual: "Telefonnummeret og beskedloggen slettes manuelt hos inMobile — der er ingen verificeret API til det.",
      manualIsGap: true,
    });
  }
  if (facts.ownedSummaries > 0) {
    externals.push({
      processor: "ordbogen",
      label: "Ordbogen (AI-resuméer, transskription)",
      automatic: null,
      manual: "Mødeindhold er behandlet hos Ordbogen. Verificér at intet persisteres hos leverandøren (stateless-antagelsen, ADR 0024) og slet evt. transskript og lyd.",
      manualIsGap: true,
    });
  }

  return {
    userId: facts.user.id,
    roles: facts.roles,
    displayName: facts.user.displayName,
    hasPartnerProfile: profile !== null,
    deletions,
    boardRemovals,
    upcomingBookingUids,
    hasBookings,
    blockers,
    externals,
    executable: blockers.length === 0,
  };
}

/** Læs og beregn. `fetchRows` skal være service-role-fetcheren — kald kun bag et admin-tjek. */
export async function planErasure(
  fetchRows: RowFetcher,
  userId: string,
  actorId: string,
  now: Date = new Date(),
): Promise<ErasurePlan> {
  try {
    return computeErasurePlan(await readErasureFacts(fetchRows, userId, actorId, now));
  } catch (e) {
    // Samme rækkegrænse som indsigtsudtrækket — men det er en sletteplan, ikke et udtræk.
    if (e instanceof SubjectExportTooLargeError) {
      throw new Error(e.message.replace("Udtrækket er for stort", "Sletteplanen er for stor"));
    }
    throw e;
  }
}

/** Praktisk: plan direkte mod en service-role-klient. */
export function planErasureWithService(
  service: SupabaseClient,
  userId: string,
  actorId: string,
  now?: Date,
): Promise<ErasurePlan> {
  return planErasure(supabaseRowFetcher(service), userId, actorId, now);
}
