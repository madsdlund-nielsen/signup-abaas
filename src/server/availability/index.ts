/**
 * Læsevej for partner-tilgængelighed (fase 5.3, ADR 0052). To adgangsveje, bevidst adskilt:
 *
 *   - `getMyAvailability` — partnerens EGNE rækker via den authed klient. RLS
 *     (`partner_*_select_self`, 0018) scoper til auth.uid(); intet ejerfilter her.
 *   - `readBoardCalendars` / `getBoardCommonWindows` — et boards partnere, via service-role.
 *     Ejeren har BEVIDST ingen select-policy på tabellerne (fraværsnoten er privat, ADR 0052),
 *     så booking-visningen beregnes her og afleverer kun fælles ledige vinduer — aldrig
 *     rækker eller noter. Service-role bypasser RLS, så ejerskabet af boardet verificeres
 *     eksplicit (som i meetings/boards).
 *
 * Ukonfigureret Supabase → tom/null (kontofri CI/dev).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase, createServiceSupabase } from "@/server/auth/supabase-server";

import {
  copenhagenDateOf,
  findCommonWindows,
  type AbsencePeriod,
  type AvailabilitySlot,
  type PartnerCalendar,
} from "./algorithm";

/** Fast mødelængde i v1 (byggespec §4). Forberedelsen (15 min) er honorartid, ikke mødetid. */
export const MEETING_DURATION_MINUTES = 60;

export interface MyAvailabilitySlot extends AvailabilitySlot {
  id: string;
}

export interface MyAbsence extends AbsencePeriod {
  id: string;
  note: string | null;
}

export interface MyAvailability {
  slots: MyAvailabilitySlot[];
  absences: MyAbsence[];
}

interface SlotRow {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
}

interface AbsenceRow {
  id: string;
  starts_on: string;
  ends_on: string;
  note: string | null;
}

/** Partnerens egne vinduer og fravær (RLS-scopet). */
export async function getMyAvailability(
  partnerProfileId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<MyAvailability> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return { slots: [], absences: [] };
  const supabase = await createServerSupabase(config);

  const [slots, absences] = await Promise.all([
    supabase
      .from("partner_availability")
      .select("id, weekday, start_time, end_time")
      .eq("partner_profile_id", partnerProfileId)
      .order("weekday")
      .order("start_time"),
    supabase
      .from("partner_absence")
      .select("id, starts_on, ends_on, note")
      .eq("partner_profile_id", partnerProfileId)
      .order("starts_on"),
  ]);
  if (slots.error) console.error(`[availability] vinduer fejlede: ${slots.error.message}`);
  if (absences.error) console.error(`[availability] fravær fejlede: ${absences.error.message}`);

  return {
    slots: ((slots.data ?? []) as SlotRow[]).map((r) => ({
      id: r.id,
      weekday: r.weekday,
      startTime: r.start_time,
      endTime: r.end_time,
    })),
    absences: ((absences.data ?? []) as AbsenceRow[]).map((r) => ({
      id: r.id,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      note: r.note,
    })),
  };
}

export interface BoardPartnerCalendar {
  partnerProfileId: string;
  name: string;
  calendar: PartnerCalendar;
}

/**
 * Alle boardets partnere med navn og kalender. KUN til server-side brug med en service-role-
 * klient, efter at kalderen har verificeret retten til boardet. Kaster ved læsefejl: en
 * tilgængelighedskontrol der ikke kan læse sine data må ikke svare "ledig".
 */
export async function readBoardCalendars(
  service: SupabaseClient,
  boardId: string,
): Promise<BoardPartnerCalendar[]> {
  const { data: members, error: membersError } = await service
    .from("board_partner")
    .select("partner_id, partner_profile(name)")
    .eq("board_id", boardId);
  if (membersError) {
    throw new Error(`Kunne ikke læse boardets partnere: ${membersError.message}`);
  }

  const partners = ((members ?? []) as unknown as Array<{
    partner_id: string;
    partner_profile: { name: string } | Array<{ name: string }> | null;
  }>).map((row) => {
    const profile = Array.isArray(row.partner_profile) ? row.partner_profile[0] : row.partner_profile;
    return { partnerProfileId: row.partner_id, name: profile?.name ?? "En partner" };
  });
  if (partners.length === 0) return [];
  const ids = partners.map((p) => p.partnerProfileId);

  const [slots, absences] = await Promise.all([
    service
      .from("partner_availability")
      .select("partner_profile_id, weekday, start_time, end_time")
      .in("partner_profile_id", ids),
    service
      .from("partner_absence")
      .select("partner_profile_id, starts_on, ends_on")
      .in("partner_profile_id", ids),
  ]);
  if (slots.error) throw new Error(`Kunne ikke læse tilgængelighed: ${slots.error.message}`);
  if (absences.error) throw new Error(`Kunne ikke læse fravær: ${absences.error.message}`);

  const slotRows = (slots.data ?? []) as Array<SlotRow & { partner_profile_id: string }>;
  const absenceRows = (absences.data ?? []) as Array<AbsenceRow & { partner_profile_id: string }>;

  return partners.map((p) => ({
    ...p,
    calendar: {
      slots: slotRows
        .filter((r) => r.partner_profile_id === p.partnerProfileId)
        .map((r) => ({ weekday: r.weekday, startTime: r.start_time, endTime: r.end_time })),
      absences: absenceRows
        .filter((r) => r.partner_profile_id === p.partnerProfileId)
        .map((r) => ({ startsOn: r.starts_on, endsOn: r.ends_on })),
    },
  }));
}

export interface BoardWindowsView {
  /** ISO-tidspunkter (serialiserbare til klient-/server-komponenter). */
  windows: Array<{ start: string; end: string }>;
  /** Falsk hvis ingen på boardet har begrænset sig — så er alle tidspunkter åbne. */
  anyRestriction: boolean;
  /** Navne på boardets partnere der HAR angivet tilgængelighed eller fravær. */
  restrictedNames: string[];
}

/**
 * Boardets fælles ledige vinduer de næste 7 døgn, til ejerens bookingside. Verificerer at
 * boardet tilhører den nuværende ejer. Vinduer kortere end mødelængden udelades.
 */
export async function getBoardCommonWindows(
  boardId: string,
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): Promise<BoardWindowsView | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;
  const user = requireRole(await getCurrentUser(env), "ejer");

  const service = createServiceSupabase(config);
  const { data: owned } = await service
    .from("board")
    .select("id")
    .eq("id", boardId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!owned) return null;

  const partners = await readBoardCalendars(service, boardId);
  const { windows, anyRestriction } = findCommonWindows(
    partners.map((p) => p.calendar),
    {
      startDate: copenhagenDateOf(now),
      days: 7,
      minimumMinutes: MEETING_DURATION_MINUTES,
      notBefore: now,
    },
  );
  return {
    windows: windows.map((w) => ({ start: w.start.toISOString(), end: w.end.toISOString() })),
    anyRestriction,
    restrictedNames: partners
      .filter((p) => p.calendar.slots.length > 0 || p.calendar.absences.length > 0)
      .map((p) => p.name),
  };
}
