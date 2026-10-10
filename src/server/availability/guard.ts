/**
 * Booking-vagten (fase 5.3, ADR 0052): afviser et møde hvis en boardpartner med ANGIVET
 * tilgængelighed ikke er ledig i tidsrummet. Kaldes ét sted pr. mødeaktion i
 * src/server/meetings/actions.ts (book/initiér via createMeetingForBoard, flyt via
 * assertMeetingBoardAvailable) — den eneste kobling mellem de to moduler.
 *
 * Tjekker mødetiden (60 min); de 15 forberedelsesminutter er partnerens egen, betalte tid og
 * kræver ikke at hun er "ledig" i booking-forstand. Fejlen er en almindelig Error med en
 * dansk, brugervendt besked — actions.ts' toError viser den i formularen.
 *
 * Service-role-klienten kommer fra kalderen (som i resten af actions); vagten læser kun.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { findUnavailable } from "./algorithm";
import { MEETING_DURATION_MINUTES, readBoardCalendars } from "./index";

/** "A", "A og B", "A, B og C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} og ${names[names.length - 1]}`;
}

/** Den brugervendte besked når nogen ikke er ledige. Eksporteret så den kan enhedstestes. */
export function unavailableMessage(names: string[]): string {
  const verb = names.length === 1 ? "er ikke ledig" : "er ikke ledige";
  return `Mødet kan ikke bookes: ${joinNames(names)} ${verb} på det valgte tidspunkt. Vælg et andet tidspunkt.`;
}

/** Kaster hvis en partner på boardet ikke er ledig i [startsAt, startsAt + 60 min). */
export async function assertBoardAvailable(
  service: SupabaseClient,
  boardId: string,
  startsAt: string | Date,
): Promise<void> {
  const start = startsAt instanceof Date ? startsAt : new Date(startsAt);
  if (Number.isNaN(start.getTime())) throw new Error("Ugyldigt starttidspunkt.");

  const partners = await readBoardCalendars(service, boardId);
  const unavailable = findUnavailable(partners, start, MEETING_DURATION_MINUTES);
  if (unavailable.length > 0) throw new Error(unavailableMessage(unavailable.map((p) => p.name)));
}

/** Som `assertBoardAvailable`, men finder boardet ud fra et eksisterende møde (flytning). */
export async function assertMeetingBoardAvailable(
  service: SupabaseClient,
  meetingId: string,
  startsAt: string | Date,
): Promise<void> {
  const { data, error } = await service
    .from("meeting")
    .select("board_id")
    .eq("id", meetingId)
    .maybeSingle();
  if (error || !data) throw new Error("Møde ikke fundet.");
  await assertBoardAvailable(service, (data as { board_id: string }).board_id, startsAt);
}
