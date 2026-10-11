/**
 * Boardets sammensætning: invarianterne og de skrivende trin, FÆLLES for ejerens vej
 * (`./actions`) og admins vej (`./admin-actions`) — ADR 0062. Ingen "use server" her: modulet
 * eksporterer pure funktioner og service-role-hjælpere, ikke handlinger. Auth- og ejerskabstjek
 * hører til i den der kalder; intet her tjekker hvem brugeren er.
 *
 * Invarianter (byggespec §3/§5.2/§5.6), ens for begge veje:
 *   - 2-3 partnere (MIN_BOARD_SIZE/MAX_BOARD_SIZE), ingen dubletter
 *   - mindst én intern partner
 *   - lead er altid en intern partner på boardet, og der er præcis én
 * De er invarianter på tværs af rækker og håndhæves derfor her, ikke som DB-constraint (0010).
 *
 * TODO(ejer): lead-partner regler — tildeling og rotation er uafklaret. "Første interne" og
 * "bevar nuværende lead" er pladsholdere, ikke en beslutning.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { createBookingProvider } from "@/lib/booking";
import type { BookingProvider } from "@/lib/booking/port";
import { syncBoardHosts, type HostsSync } from "@/server/meetings/board-hosts";
import { MAX_BOARD_SIZE, MIN_BOARD_SIZE } from "@/server/matching/algorithm";
import { recordBoardChange, type BoardActor } from "./audit";

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
 * Hvem er lead bagefter? Nuværende lead består hvis hun stadig sidder på boardet og er intern;
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
 * Skriv en plan til databasen. Rækkefølgen er valgt så boardet aldrig er mindre end før: først
 * indsættes de nye, så fjernes de gamle, til sidst flyttes lead-markeringen. Det er ikke én
 * transaktion (supabase-js har ingen) — fejler et senere trin, står boardet i en mellemtilstand,
 * og fejlen kastes højlydt frem for at blive slugt. Planen er afvist FØR første write, så en
 * invariant-fejl aldrig efterlader halve ændringer.
 */
async function applyPlan(
  service: SupabaseClient,
  boardId: string,
  rows: readonly MemberRow[],
  plan: BoardPlan,
): Promise<void> {
  if (plan.add.length > 0) {
    const { data, error } = await service
      .from("board_partner")
      .insert(
        plan.add.map((partnerId) => ({
          board_id: boardId,
          partner_id: partnerId,
          is_lead: partnerId === plan.leadId,
        })),
      )
      .select("partner_id");
    if (error || !data || data.length !== plan.add.length) {
      throw new Error(`Kunne ikke tilføje partneren: ${error?.message ?? "ingen række skrevet"}`);
    }
  }

  if (plan.remove.length > 0) {
    const { error } = await service
      .from("board_partner")
      .delete()
      .eq("board_id", boardId)
      .in("partner_id", plan.remove);
    if (error) throw new Error(`Kunne ikke fjerne partneren: ${error.message}`);
  }

  // Lead-markeringen: sæt den nye først, ryd derefter de øvrige — aldrig et øjeblik uden lead.
  const stays = rows.filter((row) => !plan.remove.includes(row.partner_id));
  if (plan.leadId && !plan.add.includes(plan.leadId)) {
    const alreadyLead = stays.some((row) => row.partner_id === plan.leadId && row.is_lead);
    if (!alreadyLead) {
      const { data, error } = await service
        .from("board_partner")
        .update({ is_lead: true })
        .eq("board_id", boardId)
        .eq("partner_id", plan.leadId)
        .select("partner_id");
      if (error || !data || data.length === 0) {
        throw new Error(`Kunne ikke sætte lead: ${error?.message ?? "ingen række ramt"}`);
      }
    }
  }
  const toClear = stays.filter((row) => row.is_lead && row.partner_id !== plan.leadId).map((r) => r.partner_id);
  if (toClear.length > 0) {
    const { error } = await service
      .from("board_partner")
      .update({ is_lead: false })
      .eq("board_id", boardId)
      .in("partner_id", toClear);
    if (error) throw new Error(`Kunne ikke rydde lead: ${error.message}`);
  }
}

/** Læs → valider → skriv. Kaster dansk fejl ved brud på en invariant; intet er skrevet da. */
export async function changeBoardComposition(
  service: SupabaseClient,
  boardId: string,
  change: BoardChange,
): Promise<BoardPlan> {
  const rows = await readMembers(service, boardId);
  const internalById = await readInternalFlags(service, nextPartnerIds(rows, change));
  const plan = planBoardChange(rows, change, internalById);
  await applyPlan(service, boardId, rows, plan);
  return plan;
}

export interface AppliedBoardChange {
  plan: BoardPlan;
  hosts: HostsSync;
}

/**
 * Hele ændringen for begge veje: skriv sammensætningen, opdatér Cal.com-hosts, log. Hosts-
 * synkroniseringen kan ikke rulle ændringen tilbage (den er allerede i Supabase, sandhedskilden):
 * en fejl kommer tilbage som `hosts.status === "fejlet"`, bliver logget på revisionssporet, og
 * kalderen viser den. Et board uden Cal.com-event type (endnu) springes over.
 */
export async function applyBoardChange(
  service: SupabaseClient,
  actor: BoardActor,
  boardId: string,
  change: BoardChange,
  booking: BookingProvider = createBookingProvider(),
): Promise<AppliedBoardChange> {
  const plan = await changeBoardComposition(service, boardId, change);

  const hosts: HostsSync = plan.hostsAffected
    ? await syncBoardHosts(service, boardId, { createIfMissing: false }, booking)
    : { status: "sprunget_over", reason: "ikke_relevant" };
  if (hosts.status === "fejlet") {
    console.error(`[boards] Cal.com-hosts ikke opdateret for board ${boardId}: ${hosts.message}`);
  }

  await recordBoardChange(service, {
    boardId,
    actor,
    action: change.kind,
    partnerId: change.kind === "udskift" ? change.incomingId : change.partnerId,
    replacedPartnerId: change.kind === "udskift" ? change.outgoingId : null,
    calcomSync: hosts.status === "opdateret" ? "opdateret" : hosts.status === "fejlet" ? "fejlet" : "sprunget_over",
  });

  return { plan, hosts };
}
