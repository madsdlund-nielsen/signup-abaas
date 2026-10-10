/**
 * Mødehjælpere til rolle-dashboardene (fase 5.4, ADR 0055). Rene: ingen Supabase-, env- eller
 * React-afhængigheder, så "hvad er et kommende møde" kan enhedstestes uden DB. `listMyMeetings`
 * leverer alt brugeren må se; her afgøres hvad et dashboard viser ud af det.
 */

import type { Meeting } from "@/server/meetings";

/** Det et dashboard behøver af et møde — så tests ikke skal opfinde resten. */
export type DashboardMeeting = Pick<
  Meeting,
  "id" | "boardId" | "startsAt" | "status" | "videoJoinUrl" | "participants"
>;

const TIME_ZONE = "Europe/Copenhagen";

/**
 * Kommende møder: planlagte, hvis starttidspunkt ikke ligger før `now`, tidligst først.
 *
 * `boardId` afgrænser til ét board. Det er nødvendigt og ikke pynt: for en admin returnerer RLS
 * ALLE møder (meeting_select_admin), så en bruger der både er admin og ejer/partner ville ellers
 * se andres møder under "mine". Uparsbare tidspunkter udelades hellere end at lande først.
 */
export function upcomingMeetings<M extends Pick<Meeting, "boardId" | "startsAt" | "status">>(
  meetings: readonly M[],
  now: Date,
  boardId?: string,
): M[] {
  const nowMs = now.getTime();
  return meetings
    .filter((meeting) => {
      if (meeting.status !== "planlagt") return false;
      if (boardId !== undefined && meeting.boardId !== boardId) return false;
      const startMs = Date.parse(meeting.startsAt);
      return !Number.isNaN(startMs) && startMs >= nowMs;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** "mandag den 12. oktober 2026 kl. 10.00" — dansk tid, uanset serverens tidszone. */
export function formatMeetingStart(startsAt: string): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("da-DK", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: TIME_ZONE,
  }).format(date);
}

/** Kortere form til lister: "12. okt. 2026, 10.00". */
export function formatMeetingStartShort(startsAt: string): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("da-DK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TIME_ZONE,
  }).format(date);
}

/** Deltagernavne som tekst; tom liste giver en ærlig tekst frem for en tom streng. */
export function participantNames(meeting: Pick<DashboardMeeting, "participants">): string {
  const names = meeting.participants.map((participant) => participant.name);
  return names.length === 0 ? "Ingen deltagere endnu" : names.join(", ");
}
