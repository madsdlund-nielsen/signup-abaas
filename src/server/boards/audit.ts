/**
 * Revisionsspor for boardets sammensætning (`board_change`, migration 0025, ADR 0062). Skrives af
 * service-role bag den der kalder (ejer- eller admin-action); læses kun af admin (RLS).
 *
 * Sporet er bevidst uden persondata ud over pseudonyme id'er — ingen navne eller e-mails.
 *
 * To skrivestier (ADR 0064):
 *   - Sammensætningsændringer skrives af `change_board_composition` (0026) i SAMME transaktion som
 *     ændringen selv — en fejl her ruller ændringen tilbage, så sporet aldrig mangler en ændring.
 *     `settleBoardChangeSync` retter bagefter kun Cal.com-udfaldet.
 *   - Alt andet (`opdater_hosts`: ingen sammensætning at holde atomisk med) skrives af
 *     `recordBoardChange`, hvor et log-fejl aldrig må vælte handlingen: den er allerede sket i
 *     Supabase. Fejlen logges (uden persondata) i stedet.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type BoardActorRole = "ejer" | "admin";

export interface BoardActor {
  id: string;
  role: BoardActorRole;
}

export type BoardChangeAction = "tilfoej" | "fjern" | "udskift" | "saet_lead" | "opdater_hosts";
export type CalcomSyncResult = "opdateret" | "fejlet" | "sprunget_over";

export interface BoardChangeEntry {
  boardId: string;
  actor: BoardActor;
  action: BoardChangeAction;
  partnerId?: string | null;
  replacedPartnerId?: string | null;
  calcomSync: CalcomSyncResult;
}

export async function recordBoardChange(service: SupabaseClient, entry: BoardChangeEntry): Promise<void> {
  try {
    const { error } = await service.from("board_change").insert({
      board_id: entry.boardId,
      actor_id: entry.actor.id,
      actor_role: entry.actor.role,
      action: entry.action,
      partner_id: entry.partnerId ?? null,
      replaced_partner_id: entry.replacedPartnerId ?? null,
      calcom_sync: entry.calcomSync,
    });
    if (error) console.error(`[boards] revisionsspor ikke skrevet for board ${entry.boardId}: ${error.message}`);
  } catch (e) {
    console.error(
      `[boards] revisionsspor ikke skrevet for board ${entry.boardId}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Ret Cal.com-udfaldet på en række `change_board_composition` allerede har skrevet (med den
 * pessimistiske værdi). Et fejlet kald lader rækken stå som den er — "hosts hænger efter" — og
 * logges uden persondata; det vælter aldrig ændringen.
 */
export async function settleBoardChangeSync(
  service: SupabaseClient,
  changeId: string,
  calcomSync: CalcomSyncResult,
): Promise<void> {
  try {
    const { error } = await service.from("board_change").update({ calcom_sync: calcomSync }).eq("id", changeId);
    if (error) console.error(`[boards] Cal.com-udfald ikke gemt på revisionssporet: ${error.message}`);
  } catch (e) {
    console.error(
      `[boards] Cal.com-udfald ikke gemt på revisionssporet: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export interface BoardChangeRow {
  id: string;
  boardId: string;
  actorRole: BoardActorRole;
  action: BoardChangeAction;
  partnerId: string | null;
  replacedPartnerId: string | null;
  calcomSync: CalcomSyncResult;
  createdAt: string;
}

/**
 * Hænger boardets Cal.com-hosts efter sammensætningen? Ja, når den SENESTE handling der rørte
 * Cal.com (ikke en overspringning) fejlede — en senere vellykket "Opdatér hosts" ophæver den.
 * `changes` skal være nyeste først.
 */
export function hostsOutOfSync(changes: ReadonlyArray<{ calcomSync: CalcomSyncResult }>): boolean {
  const latest = changes.find((change) => change.calcomSync !== "sprunget_over");
  return latest?.calcomSync === "fejlet";
}
