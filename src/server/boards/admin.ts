/**
 * Admins læsevej til boards: overblikket (`/admin/boards`) og editoren (`/admin/boards/[id]`),
 * ADR 0062. Læser med SERVICE-ROLE bag requireRole('admin'), fordi overblikket samler på tværs af
 * tabeller hvor admin ikke har (eller ikke bør have) en RLS-policy: ejerens navn/e-mail
 * (`app_user` kan kun læses af brugeren selv, 0006) og ejerens quiz-behov (kun tag-id'er forlader
 * funktionen, jf. ./matching/owner-needs). Rolle-guarden i /admin/layout.tsx er første lag; denne
 * kontrol er andet.
 *
 * Ukonfigureret Supabase → tom/null (kontofri CI/dev).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import type { MatchPartner } from "@/server/matching";
import { readOwnerTagIds } from "@/server/matching/owner-needs";
import { hostsOutOfSync, type BoardChangeAction, type BoardChangeRow, type CalcomSyncResult } from "./audit";

export interface AdminBoardMember {
  partnerId: string;
  name: string;
  title: string | null;
  isInternal: boolean;
  isLead: boolean;
  hasCalcomUser: boolean;
  competenceTagIds: string[];
}

export interface AdminBoardOverview {
  id: string;
  name: string;
  /** Ejerens visningsnavn, ellers e-mailen. Null hvis ejeren er slettet. */
  ownerLabel: string | null;
  ownerEmail: string | null;
  members: AdminBoardMember[];
  meetingCount: number;
  /** Null: boardet har ingen membership-række endnu. */
  membershipStatus: "aktiv" | "opsagt" | null;
  /** Boardets collective event type hos Cal.com (0019). Null = ikke oprettet endnu. */
  calcomEventTypeId: number | null;
  /** Hænger event typens hosts efter sammensætningen? (Seneste Cal.com-handling fejlede.) */
  hostsOutOfSync: boolean;
}

export interface AdminBoardDetail extends AdminBoardOverview {
  ownerId: string;
  /** Ejerens kompetencebehov som tag-id'er. Null = kunne ikke læses (≠ "ingen behov"). */
  ownerTagIds: string[] | null;
  /** Hele katalogposterne, til tilføj/udskift. Inkluderer også boardets egne medlemmer. */
  pool: MatchPartner[];
  /** Seneste ændringer, nyeste først. */
  changes: BoardChangeRow[];
}

interface ProfileRow {
  id: string;
  name: string;
  title: string | null;
  is_internal: boolean;
  short_bio: string | null;
  long_bio: string | null;
  photo_url: string | null;
  sort_order: number;
  calcom_user_id: number | null;
  partner_profile_competence_tag: Array<{ competence_tag_id: string }> | null;
}

// Én sammenhængende literal — se noten ved POOL_COLUMNS i src/server/matching.
const PROFILE_COLUMNS =
  "id, name, title, is_internal, short_bio, long_bio, photo_url, sort_order, calcom_user_id, partner_profile_competence_tag(competence_tag_id)";

const CHANGE_HISTORY_LIMIT = 15;

async function requireAdminService(env: Record<string, string | undefined>): Promise<SupabaseClient | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;
  requireRole(await getCurrentUser(env), "admin");
  return createServiceSupabase(config);
}

function profileToCandidate(row: ProfileRow): MatchPartner {
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

interface BoardRow {
  id: string;
  name: string;
  owner_id: string;
  calcom_event_type_id: number | null;
}

interface ChangeDbRow {
  id: string;
  board_id: string;
  actor_role: "ejer" | "admin";
  action: BoardChangeAction;
  partner_id: string | null;
  replaced_partner_id: string | null;
  calcom_sync: CalcomSyncResult;
  created_at: string;
}

function toChangeRow(row: ChangeDbRow): BoardChangeRow {
  return {
    id: row.id,
    boardId: row.board_id,
    actorRole: row.actor_role,
    action: row.action,
    partnerId: row.partner_id,
    replacedPartnerId: row.replaced_partner_id,
    calcomSync: row.calcom_sync,
    createdAt: row.created_at,
  };
}

/** Kast ved læsefejl: et overblik der tier stille ligner "ingen boards". */
function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Kunne ikke læse ${what}: ${result.error.message}`);
  return (result.data ?? ([] as unknown)) as T;
}

/**
 * Overblikket for et sæt boards (eller alle): samler boards, medlemmer, ejere, møder,
 * medlemskab og Cal.com-status i et fast antal forespørgsler (ikke ét pr. board).
 */
async function loadOverviews(
  service: SupabaseClient,
  boardId: string | null,
): Promise<{ overviews: AdminBoardOverview[]; owners: Map<string, string>; profiles: Map<string, ProfileRow> }> {
  const boardsQuery = service
    .from("board")
    .select("id, name, owner_id, calcom_event_type_id")
    .order("created_at");
  const boards = unwrap<BoardRow[]>(await (boardId ? boardsQuery.eq("id", boardId) : boardsQuery), "boards");
  const boardIds = boards.map((b) => b.id);
  const empty = { overviews: [], owners: new Map<string, string>(), profiles: new Map<string, ProfileRow>() };
  if (boardIds.length === 0) return empty;

  const [memberRows, profileRows, ownerRows, meetingRows, membershipRows, syncRows] = await Promise.all([
    service.from("board_partner").select("board_id, partner_id, is_lead").in("board_id", boardIds),
    service.from("partner_profile").select(PROFILE_COLUMNS),
    service.from("app_user").select("id, email, display_name").in("id", [...new Set(boards.map((b) => b.owner_id))]),
    service.from("meeting").select("board_id").in("board_id", boardIds),
    service.from("membership").select("board_id, status").in("board_id", boardIds),
    service
      .from("board_change")
      .select("board_id, calcom_sync, created_at")
      .in("board_id", boardIds)
      .order("created_at", { ascending: false }),
  ]);

  const members = unwrap<Array<{ board_id: string; partner_id: string; is_lead: boolean }>>(memberRows, "medlemmer");
  const profiles = new Map(unwrap<ProfileRow[]>(profileRows, "partnerprofiler").map((p) => [p.id, p]));
  const ownersById = new Map(
    unwrap<Array<{ id: string; email: string; display_name: string | null }>>(ownerRows, "ejere").map((o) => [
      o.id,
      o,
    ]),
  );
  const meetings = unwrap<Array<{ board_id: string }>>(meetingRows, "møder");
  const memberships = new Map(
    unwrap<Array<{ board_id: string; status: "aktiv" | "opsagt" }>>(membershipRows, "medlemskaber").map((m) => [
      m.board_id,
      m.status,
    ]),
  );
  const syncs = unwrap<Array<{ board_id: string; calcom_sync: CalcomSyncResult }>>(syncRows, "revisionsspor");

  const overviews = boards.map((board): AdminBoardOverview => {
    const owner = ownersById.get(board.owner_id);
    const boardMembers: AdminBoardMember[] = members
      .filter((m) => m.board_id === board.id)
      .map((m) => ({ row: profiles.get(m.partner_id), isLead: m.is_lead }))
      .filter((entry): entry is { row: ProfileRow; isLead: boolean } => entry.row != null)
      .map(({ row, isLead }) => ({
        partnerId: row.id,
        name: row.name,
        title: row.title,
        isInternal: row.is_internal,
        isLead,
        hasCalcomUser: row.calcom_user_id != null,
        competenceTagIds: (row.partner_profile_competence_tag ?? []).map((t) => t.competence_tag_id),
      }))
      .sort((a, b) => Number(b.isLead) - Number(a.isLead) || a.name.localeCompare(b.name, "da"));

    return {
      id: board.id,
      name: board.name,
      ownerLabel: owner?.display_name || owner?.email || null,
      ownerEmail: owner?.email ?? null,
      members: boardMembers,
      meetingCount: meetings.filter((m) => m.board_id === board.id).length,
      membershipStatus: memberships.get(board.id) ?? null,
      calcomEventTypeId: board.calcom_event_type_id,
      hostsOutOfSync: hostsOutOfSync(
        syncs.filter((s) => s.board_id === board.id).map((s) => ({ calcomSync: s.calcom_sync })),
      ),
    };
  });

  return { overviews, owners: new Map(boards.map((b) => [b.id, b.owner_id])), profiles };
}

/** Alle boards med ejer, medlemmer, møder, medlemskab og Cal.com-status til admins overblik. */
export async function listAdminBoardOverviews(
  env: Record<string, string | undefined> = process.env,
): Promise<AdminBoardOverview[]> {
  const service = await requireAdminService(env);
  if (!service) return [];
  try {
    return (await loadOverviews(service, null)).overviews;
  } catch (e) {
    console.error(`[boards] listAdminBoardOverviews fejlede: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/** Ét board til editoren: overblikket + ejerens behov, hele puljen og de seneste ændringer. */
export async function getAdminBoardDetail(
  boardId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<AdminBoardDetail | null> {
  const service = await requireAdminService(env);
  if (!service) return null;
  try {
    const { overviews, owners, profiles } = await loadOverviews(service, boardId);
    const overview = overviews[0];
    const ownerId = owners.get(boardId);
    if (!overview || !ownerId) return null;

    const [ownerTagIds, changeRows] = await Promise.all([
      readOwnerTagIds(service, ownerId),
      service
        .from("board_change")
        .select("id, board_id, actor_role, action, partner_id, replaced_partner_id, calcom_sync, created_at")
        .eq("board_id", boardId)
        .order("created_at", { ascending: false })
        .limit(CHANGE_HISTORY_LIMIT),
    ]);

    return {
      ...overview,
      ownerId,
      ownerTagIds,
      pool: [...profiles.values()]
        .map(profileToCandidate)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "da")),
      changes: unwrap<ChangeDbRow[]>(changeRows, "ændringerne").map(toChangeRow),
    };
  } catch (e) {
    console.error(`[boards] getAdminBoardDetail fejlede: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
