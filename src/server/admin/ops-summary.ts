/**
 * Rene aggregeringer til driftsoverblikket (fase 5.4, ADR 0053).
 *
 * Læselogikken henter rå rækker; her bliver de til tal. Adskilt fra Supabase-kaldene, så
 * tællingerne kan testes uden en database — samme opdeling som `src/server/ratings/summary.ts`.
 * Intet her indeholder en forretningsregel: kun optælling af hvad der står i tabellerne.
 */

export interface BoardRow {
  owner_id: string;
}

export interface PartnerRow {
  app_user_id: string | null;
}

export interface MembershipRow {
  status: "aktiv" | "opsagt";
  card_status: "mangler" | "registreret";
}

export type ChargeStatus = "afventer" | "gennemfoert" | "fejlet";

export interface ChargeRow {
  id: string;
  status: ChargeStatus;
  failure_reason: string | null;
  updated_at: string;
}

export type MeetingStatus = "planlagt" | "aflyst" | "afholdt";

export interface MeetingRow {
  status: MeetingStatus;
  starts_at: string;
}

export interface MissingRegistrationRow {
  meeting_id: string;
}

export interface PlatformCounts {
  boards: number;
  /** Ejere med mindst ét board. Ejere uden board er ikke synlige for admin via RLS. */
  ownersWithBoard: number;
  partners: number;
  partnersLinked: number;
  partnersUnlinked: number;
}

export function countPlatform(boards: readonly BoardRow[], partners: readonly PartnerRow[]): PlatformCounts {
  const linked = partners.filter((p) => p.app_user_id !== null).length;
  return {
    boards: boards.length,
    ownersWithBoard: new Set(boards.map((b) => b.owner_id)).size,
    partners: partners.length,
    partnersLinked: linked,
    partnersUnlinked: partners.length - linked,
  };
}

export interface MembershipCounts {
  total: number;
  active: number;
  cancelled: number;
  cardRegistered: number;
  cardMissing: number;
}

export function countMemberships(rows: readonly MembershipRow[]): MembershipCounts {
  const active = rows.filter((r) => r.status === "aktiv").length;
  const registered = rows.filter((r) => r.card_status === "registreret").length;
  return {
    total: rows.length,
    active,
    cancelled: rows.length - active,
    cardRegistered: registered,
    cardMissing: rows.length - registered,
  };
}

export interface ChargeFailure {
  id: string;
  failedAt: string;
  /** Leverandørens fejlårsag, som den er registreret. Null = ingen årsag modtaget. */
  reason: string | null;
}

export interface ChargeCounts {
  pending: number;
  succeeded: number;
  failed: number;
  recentFailures: ChargeFailure[];
}

export const RECENT_FAILURE_LIMIT = 5;

export function countCharges(
  rows: readonly ChargeRow[],
  limit: number = RECENT_FAILURE_LIMIT,
): ChargeCounts {
  const failed = rows.filter((r) => r.status === "fejlet");
  return {
    pending: rows.filter((r) => r.status === "afventer").length,
    succeeded: rows.filter((r) => r.status === "gennemfoert").length,
    failed: failed.length,
    recentFailures: [...failed]
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, limit)
      .map((r) => ({ id: r.id, failedAt: r.updated_at, reason: r.failure_reason })),
  };
}

export interface MeetingCounts {
  windowDays: number;
  /** Planlagt og endnu ikke startet. */
  upcoming: number;
  /** Stadig `planlagt`, men starttidspunktet er passeret — mangler en status. */
  overdue: number;
  held: number;
  cancelled: number;
}

export const MEETING_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Kommende = planlagt i fremtiden. Afholdt/aflyst tælles kun i vinduet (seneste N dage),
 * fordi et driftsoverblik skal vise nylig aktivitet, ikke hele historikken.
 */
export function countMeetings(
  rows: readonly MeetingRow[],
  now: Date,
  windowDays: number = MEETING_WINDOW_DAYS,
): MeetingCounts {
  const nowMs = now.getTime();
  const sinceMs = nowMs - windowDays * DAY_MS;
  const counts: MeetingCounts = { windowDays, upcoming: 0, overdue: 0, held: 0, cancelled: 0 };

  for (const row of rows) {
    const startsMs = Date.parse(row.starts_at);
    if (Number.isNaN(startsMs)) continue;
    if (row.status === "planlagt") {
      if (startsMs > nowMs) counts.upcoming += 1;
      else counts.overdue += 1;
    } else if (startsMs >= sinceMs && startsMs <= nowMs) {
      if (row.status === "afholdt") counts.held += 1;
      else counts.cancelled += 1;
    }
  }
  return counts;
}

export interface MissingRegistrations {
  /** Antal afholdte møder med mindst én partner uden registreret status. */
  meetings: number;
  /** Antal partner-rækker uden registreret status. */
  registrations: number;
}

export function countMissingRegistrations(rows: readonly MissingRegistrationRow[]): MissingRegistrations {
  return {
    meetings: new Set(rows.map((r) => r.meeting_id)).size,
    registrations: rows.length,
  };
}
