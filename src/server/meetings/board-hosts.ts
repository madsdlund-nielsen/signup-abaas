/**
 * Synkronisering af et boards Cal.com-hosts (ADR 0046, ADR 0062). Ét collective event type pr.
 * board; værterne er boardets partnere via `partner_profile.calcom_user_id`. Funktionen ligger
 * uden "use server" fordi den kaldes fra flere actions: admins "Opret/Opdatér"-knap
 * (./booking-admin) og automatisk efter en sammensætningsændring (../boards/composition).
 *
 * KONTRAKT: kaster ALDRIG. Hosts-synkroniseringen er en følgevirkning af en ændring som allerede
 * er sket i Supabase (sandhedskilden) — en Cal.com-fejl må ikke rulle sammensætningen tilbage,
 * men skal stå tydeligt, så admin kan køre "Opdatér hosts". Fejlen bliver derfor en værdi.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { createBookingProvider } from "@/lib/booking";
import type { BookingProvider } from "@/lib/booking/port";
import { recordBoardChange, type BoardActor } from "@/server/boards/audit";
import { MEETING_LENGTH_MINUTES } from "./booking-info";

export type HostsSync =
  | { status: "opdateret"; eventTypeId: number }
  | { status: "sprunget_over"; reason: "ikke_koblet" | "demo" | "ikke_relevant" }
  | { status: "fejlet"; message: string };

/** Postgres unique_violation → dansk besked (to boards kan ikke dele et event type). */
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

export interface SyncOptions {
  /**
   * Opret event typen hvis boardet ikke har et (admins "Opret"-knap). Uden: et board uden event
   * type springes over — der er intet at opdatere endnu, og booking fejler højlydt alligevel.
   */
  createIfMissing: boolean;
}

/**
 * Skriv boardets nuværende partnere som værter på dets event type hos Cal.com, og gem id'et.
 * En partner uden Cal.com-bruger gør kaldet til en højlydt fejl frem for et board med færre
 * værter end partnere (stub-politik: plausibelt, men forkert).
 */
export async function syncBoardHosts(
  service: SupabaseClient,
  boardId: string,
  options: SyncOptions,
  booking: BookingProvider = createBookingProvider(),
): Promise<HostsSync> {
  try {
    const { data: board, error: boardError } = await service
      .from("board")
      .select("id, name, calcom_event_type_id")
      .eq("id", boardId)
      .maybeSingle();
    if (boardError || !board) return { status: "fejlet", message: "Board ikke fundet." };
    const boardRow = board as { id: string; name: string; calcom_event_type_id: number | null };

    if (boardRow.calcom_event_type_id == null && !options.createIfMissing) {
      return { status: "sprunget_over", reason: "ikke_koblet" };
    }

    // Demo-id'et ville ellers blive sendt til en rigtig Cal.com den dag nøglerne lander — og et
    // falsk id gemmes aldrig på boardet. Demo har intet event type at opdatere.
    if (booking.name === "demo") return { status: "sprunget_over", reason: "demo" };

    const { data: members, error: membersError } = await service
      .from("board_partner")
      .select("partner_id")
      .eq("board_id", boardId);
    if (membersError) {
      return { status: "fejlet", message: `Kunne ikke læse boardets partnere: ${membersError.message}` };
    }
    const partnerIds = ((members ?? []) as Array<{ partner_id: string }>).map((m) => m.partner_id);
    if (partnerIds.length === 0) {
      return { status: "fejlet", message: "Boardet har ingen partnere at gøre til værter." };
    }

    const { data: profileRows, error: profilesError } = await service
      .from("partner_profile")
      .select("id, name, calcom_user_id")
      .in("id", partnerIds);
    if (profilesError) {
      return { status: "fejlet", message: `Kunne ikke læse partnerprofiler: ${profilesError.message}` };
    }
    const profiles = (profileRows ?? []) as Array<{ id: string; name: string; calcom_user_id: number | null }>;

    const missing = profiles.filter((p) => p.calcom_user_id == null).map((p) => p.name);
    if (missing.length > 0) {
      return {
        status: "fejlet",
        message:
          `Disse partnere mangler et Cal.com-bruger-id og kan ikke være værter: ${missing.join(", ")}. ` +
          `Indtast det på partnerens side først (admin → partner-katalog).`,
      };
    }

    const { eventTypeId } = await booking.upsertBoardEventType({
      eventTypeId: boardRow.calcom_event_type_id,
      title: boardRow.name,
      // Stabil og unik pr. board uden at lække navne i URL'en.
      slug: `abaas-board-${boardRow.id}`,
      lengthInMinutes: MEETING_LENGTH_MINUTES,
      hostUserIds: profiles.map((p) => p.calcom_user_id as number),
    });

    const { data: saved, error: saveError } = await service
      .from("board")
      .update({ calcom_event_type_id: eventTypeId })
      .eq("id", boardId)
      .select("id")
      .maybeSingle();
    if (isUniqueViolation(saveError)) {
      return { status: "fejlet", message: "Det Cal.com event type er allerede knyttet til et andet board." };
    }
    if (saveError || !saved) {
      return {
        status: "fejlet",
        message:
          `Event typen blev oprettet hos Cal.com (id ${eventTypeId}), men kunne ikke gemmes på boardet: ` +
          `${saveError?.message ?? "board ikke fundet"}. Genkør handlingen eller indtast id'et manuelt.`,
      };
    }
    return { status: "opdateret", eventTypeId };
  } catch (e) {
    return { status: "fejlet", message: e instanceof Error ? e.message : String(e) };
  }
}

export interface PartnerHostsSync {
  /** Boards partneren sidder på. */
  boards: number;
  /** Heraf boards hvor event typens hosts blev skrevet. (Et board uden event type springes over.) */
  updated: number;
  /** Én dansk besked pr. board hvor hosts ikke kunne skrives (eller boards ikke kunne læses). */
  failures: string[];
}

/**
 * Efter at en partners Cal.com-sæde er ændret (B-67, ADR 0064): skriv hosts på hvert board
 * partneren sidder på, så event typerne ikke peger på det gamle sæde. Kører EFTER skrivningen af
 * sædet, og en fejl ruller den ikke tilbage — samme kontrakt som `syncBoardHosts` (som aldrig
 * kaster): fejlene kommer tilbage som værdi og vises som advarsel. Hvert board der blev rørt
 * logges som `opdater_hosts` på revisionssporet, så "Hosts hænger efter" på /admin/boards også
 * dækker denne vej; et board uden event type logges ikke (intet at opdatere endnu).
 */
export async function syncHostsForPartner(
  service: SupabaseClient,
  actor: BoardActor,
  partnerId: string,
  booking: BookingProvider = createBookingProvider(),
): Promise<PartnerHostsSync> {
  const { data, error } = await service.from("board_partner").select("board_id").eq("partner_id", partnerId);
  if (error) {
    return { boards: 0, updated: 0, failures: [`Kunne ikke læse partnerens boards: ${error.message}`] };
  }
  const boardIds = [...new Set(((data ?? []) as Array<{ board_id: string }>).map((row) => row.board_id))];

  let updated = 0;
  const failures: string[] = [];
  for (const boardId of boardIds) {
    const result = await syncBoardHosts(service, boardId, { createIfMissing: false }, booking);
    if (result.status === "opdateret") updated += 1;
    if (result.status === "fejlet") {
      failures.push(result.message);
      console.error(`[boards] Cal.com-hosts ikke opdateret for board ${boardId}: ${result.message}`);
    }
    if (result.status !== "sprunget_over") {
      await recordBoardChange(service, {
        boardId,
        actor,
        action: "opdater_hosts",
        partnerId,
        calcomSync: result.status,
      });
    }
  }
  return { boards: boardIds.length, updated, failures: [...new Set(failures)] };
}
