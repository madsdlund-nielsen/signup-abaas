/**
 * Boardets sammensætning: invarianterne og de skrivende trin, FÆLLES for ejerens vej
 * (`./actions`) og admins vej (`./admin-actions`) — ADR 0062. Ingen "use server" her: modulet
 * eksporterer pure funktioner og service-role-hjælpere, ikke handlinger. Auth- og ejerskabstjek
 * hører til i den der kalder; intet her tjekker hvem brugeren er.
 *
 * Invarianter (byggespec §3/§5.2/§5.6), ens for begge veje (og håndhævet en ekstra gang af
 * `change_board_composition`, migration 0026, ADR 0064):
 *   - 2-3 partnere (MIN_BOARD_SIZE/MAX_BOARD_SIZE), ingen dubletter
 *   - mindst én intern partner
 *   - lead er altid en intern partner på boardet, og der er præcis én
 * De er invarianter på tværs af rækker og kan ikke være DB-constraints (0010): koden afviser dem før
 * skrivningen, funktionen i 0026 som sidste værn inde i transaktionen.
 *
 * TODO(ejer): lead-partner regler — tildeling og rotation er uafklaret. "Første interne" og
 * "bevar nuværende lead" er pladsholdere, ikke en beslutning.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { createBookingProvider } from "@/lib/booking";
import type { BookingProvider } from "@/lib/booking/port";
import { syncBoardHosts, type HostsSync } from "@/server/meetings/board-hosts";
import { MAX_BOARD_SIZE, MIN_BOARD_SIZE } from "@/server/matching/algorithm";
import { settleBoardChangeSync, type BoardActor } from "./audit";

/** Advarslen når hosts ikke blev opdateret — fast tekst først, så den kan genkendes i UI og test. */
export const HOSTS_WARNING = "Cal.com-hosts ikke opdateret — kør Opdatér hosts.";

export type BoardChange =
  | { kind: "tilfoej"; partnerId: string }
  | { kind: "fjern"; partnerId: string }
  | { kind: "udskift"; outgoingId: string; incomingId: string }
  | { kind: "saet_lead"; partnerId: string };

export interface MemberRow {
  partner_id: string;
  is_lead: boolean;
}

export interface BoardPlan {
  /** Medlemmerne efter ændringen, i rækkefølge. */
  nextIds: string[];
  /** Partnere der skal indsættes. */
  add: string[];
  /** Partnere der skal fjernes. */
  remove: string[];
  /** Den ene lead efter ændringen. Null kun hvis boardet ikke har en intern (afvises før). */
  leadId: string | null;
  /** Ændrer handlingen værterne på Cal.com-event typen? (Lead-markering gør ikke.) */
  hostsAffected: boolean;
}

/** Medlemmerne efter ændringen — og de rene "findes den / findes den allerede"-tjek. */
export function nextPartnerIds(rows: readonly MemberRow[], change: BoardChange): string[] {
  const ids = rows.map((row) => row.partner_id);
  switch (change.kind) {
    case "tilfoej":
      if (ids.includes(change.partnerId)) throw new Error("Partneren sidder allerede på boardet.");
      return [...ids, change.partnerId];
    case "fjern":
      if (!ids.includes(change.partnerId)) throw new Error("Partneren sidder ikke på boardet.");
      return ids.filter((id) => id !== change.partnerId);
    case "udskift":
      if (!ids.includes(change.outgoingId)) throw new Error("Partneren sidder ikke på boardet.");
      if (ids.includes(change.incomingId)) throw new Error("Partneren sidder allerede på boardet.");
      return ids.map((id) => (id === change.outgoingId ? change.incomingId : id));
    case "saet_lead":
      if (!ids.includes(change.partnerId)) throw new Error("Partneren sidder ikke på boardet.");
      return ids;
  }
}

/** 2-3 partnere, ingen dubletter, mindst én intern. */
export function assertBoardShape(partnerIds: string[], internalById: Map<string, boolean>): void {
  if (new Set(partnerIds).size !== partnerIds.length) {
    throw new Error("Den samme partner kan ikke sidde to gange på et board.");
  }
  if (partnerIds.length < MIN_BOARD_SIZE || partnerIds.length > MAX_BOARD_SIZE) {
    throw new Error(`Et board skal bestå af ${MIN_BOARD_SIZE}-${MAX_BOARD_SIZE} partnere.`);
  }
  if (!partnerIds.some((id) => internalById.get(id))) {
    throw new Error("Et board skal have mindst én intern partner.");
  }
}

/**
 * Hvem er lead bagefter? Nuværende lead består hvis vedkommende stadig sidder på boardet og er intern;
 * ellers den foretrukne (fx den indkommende ved udskift af lead'en); ellers den første interne.
 */
function resolveLead(
  nextIds: readonly string[],
  currentLeadId: string | null,
  preferredId: string | null,
  internalById: Map<string, boolean>,
): string | null {
  const usable = (id: string | null): id is string =>
    id != null && nextIds.includes(id) && internalById.get(id) === true;
  if (usable(currentLeadId)) return currentLeadId;
  if (usable(preferredId)) return preferredId;
  return nextIds.find((id) => internalById.get(id)) ?? null;
}

/** Planlæg en ændring (ren): afviser den hvis den bryder en invariant. */
export function planBoardChange(
  rows: readonly MemberRow[],
  change: BoardChange,
  internalById: Map<string, boolean>,
): BoardPlan {
  const currentIds = rows.map((row) => row.partner_id);
  const nextIds = nextPartnerIds(rows, change);
  assertBoardShape(nextIds, internalById);

  const currentLeadId = rows.find((row) => row.is_lead)?.partner_id ?? null;

  if (change.kind === "saet_lead") {
    if (!internalById.get(change.partnerId)) throw new Error("Kun en intern partner kan være lead.");
    return { nextIds, add: [], remove: [], leadId: change.partnerId, hostsAffected: false };
  }

  const preferred =
    change.kind === "udskift" && change.outgoingId === currentLeadId ? change.incomingId : null;
  return {
    nextIds,
    add: nextIds.filter((id) => !currentIds.includes(id)),
    remove: currentIds.filter((id) => !nextIds.includes(id)),
    leadId: resolveLead(nextIds, currentLeadId, preferred, internalById),
    hostsAffected: true,
  };
}

/** is_internal for et sæt katalogposter. Bruges til at håndhæve "mindst 1 intern". */
export async function readInternalFlags(
  service: SupabaseClient,
  partnerIds: string[],
): Promise<Map<string, boolean>> {
  const { data, error } = await service
    .from("partner_profile")
    .select("id, is_internal")
    .in("id", partnerIds);
  if (error) throw new Error(`Kunne ikke læse partner-profiler: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: string; is_internal: boolean }>;
  if (rows.length !== new Set(partnerIds).size) throw new Error("Ukendt partner i boardet.");
  return new Map(rows.map((row) => [row.id, row.is_internal]));
}

async function readMembers(service: SupabaseClient, boardId: string): Promise<MemberRow[]> {
  const { data, error } = await service
    .from("board_partner")
    .select("partner_id, is_lead")
    .eq("board_id", boardId);
  if (error) throw new Error(`Kunne ikke læse boardet: ${error.message}`);
  return (data ?? []) as MemberRow[];
}

/**
 * Skriv en plan til databasen som ÉN transaktion: `change_board_composition` (migration 0026,
 * ADR 0064) indsætter, fjerner, flytter lead og skriver revisionsrækken samlet — fejler ét trin,
 * står boardet som før. Funktionen tager rækkelås på boardet og afviser planen hvis medlemmerne
 * ikke længere er dem vi læste (samtidig ændring), og den håndhæver selv invarianterne som
 * sidste værn. Dem afviser koden stadig FØR kaldet (`planBoardChange`), så de almindelige fejl
 * kommer som danske beskeder uden at røre basen. Returnerer revisionsrækkens id.
 *
 * Cal.com-synkroniseringen hører IKKE til her — den sker bagefter (`applyBoardChange`).
 */
async function applyPlan(
  service: SupabaseClient,
  actor: BoardActor,
  boardId: string,
  change: BoardChange,
  rows: readonly MemberRow[],
  plan: BoardPlan,
): Promise<string> {
  const { data, error } = await service.rpc("change_board_composition", {
    p_board_id: boardId,
    p_expected_partner_ids: rows.map((row) => row.partner_id),
    p_add: plan.add,
    p_remove: plan.remove,
    p_lead_id: plan.leadId,
    p_actor_id: actor.id,
    p_actor_role: actor.role,
    p_action: change.kind,
    p_partner_id: change.kind === "udskift" ? change.incomingId : change.partnerId,
    p_replaced_partner_id: change.kind === "udskift" ? change.outgoingId : null,
  });
  if (error || typeof data !== "string") {
    throw new Error(error?.message ?? "Sammensætningen blev ikke gemt.");
  }
  return data;
}

export interface ChangedBoardComposition {
  plan: BoardPlan;
  /** Revisionsrækken `change_board_composition` skrev i samme transaktion. */
  changeId: string;
}

/** Læs → valider → skriv atomisk. Kaster dansk fejl ved brud på en invariant; intet er skrevet da. */
export async function changeBoardComposition(
  service: SupabaseClient,
  actor: BoardActor,
  boardId: string,
  change: BoardChange,
): Promise<ChangedBoardComposition> {
  const rows = await readMembers(service, boardId);
  const internalById = await readInternalFlags(service, nextPartnerIds(rows, change));
  const plan = planBoardChange(rows, change, internalById);
  const changeId = await applyPlan(service, actor, boardId, change, rows, plan);
  return { plan, changeId };
}

export interface AppliedBoardChange {
  plan: BoardPlan;
  hosts: HostsSync;
}

/**
 * Hele ændringen for begge veje: skriv sammensætningen og revisionsrækken atomisk, opdatér så
 * Cal.com-hosts. Hosts-synkroniseringen kan ikke rulle ændringen tilbage (den er allerede i
 * Supabase, sandhedskilden): en fejl kommer tilbage som `hosts.status === "fejlet"`, bliver
 * noteret på revisionsrækken, og kalderen viser den. Et board uden Cal.com-event type (endnu)
 * springes over.
 */
export async function applyBoardChange(
  service: SupabaseClient,
  actor: BoardActor,
  boardId: string,
  change: BoardChange,
  booking: BookingProvider = createBookingProvider(),
): Promise<AppliedBoardChange> {
  const { plan, changeId } = await changeBoardComposition(service, actor, boardId, change);

  const hosts: HostsSync = plan.hostsAffected
    ? await syncBoardHosts(service, boardId, { createIfMissing: false }, booking)
    : { status: "sprunget_over", reason: "ikke_relevant" };
  if (hosts.status === "fejlet") {
    console.error(`[boards] Cal.com-hosts ikke opdateret for board ${boardId}: ${hosts.message}`);
  }

  // Rækken står pessimistisk som 'fejlet' for værtsændrende handlinger (0026); ret den til udfaldet.
  // Lead-markering er allerede 'sprunget_over' og røres ikke.
  if (plan.hostsAffected) {
    const outcome = hosts.status === "opdateret" ? "opdateret" : hosts.status === "fejlet" ? "fejlet" : "sprunget_over";
    await settleBoardChangeSync(service, changeId, outcome);
  }

  return { plan, hosts };
}
