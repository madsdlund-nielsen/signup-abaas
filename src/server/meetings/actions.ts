"use server";

/**
 * Møde-mutationer (Fase 2, ADR 0026/0027). Writes via service-role bag rolle- + EKSPLICIT
 * ejerskabstjek (service-role bypasser RLS — mønster fra boards/actions). Supabase er
 * sandhedskilde: mødet skrives her FØRST, provider-kaldet (Cal.com) bagefter, og
 * provider-referencen hægtes på ved svar. Fejler provider-kaldet, kompenseres oprettelsen
 * (slet igen) og fejlen vises — et halvt booket møde er ikke en tilstand vi efterlader.
 *
 * Med stub aktiv (ingen Cal.com-nøgler) kaster porten NotConfiguredError → brugeren ser
 * den ærlige besked i formularen. Synligt hul, ikke et gæt (docs/stub-politik.md).
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthFormState } from "@/components/AuthForm";
import { getCurrentUser, requireRole, type AuthUser, type Role } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { createBookingProvider } from "@/lib/booking";
import type { MeetingRegisteredStatus } from "./index";

interface ActionContext {
  service: SupabaseClient;
  user: AuthUser;
}

async function requireContext(role: Role): Promise<ActionContext> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  const user = requireRole(await getCurrentUser(), role);
  return { service: createServiceSupabase(config), user };
}

function toError(e: unknown): AuthFormState {
  return { error: e instanceof Error ? e.message : String(e) };
}

interface BoardBookingInfo {
  ownerUserId: string;
  /** Koblede partneres auth-id'er. TODO(mads): managed-user-provisionering hos Cal.com
   *  afklares i liveverifikationen — ukoblede partnere kan ikke kalender-tjekkes endnu. */
  partnerUserIds: string[];
}

async function readBoardBookingInfo(
  service: SupabaseClient,
  boardId: string,
): Promise<BoardBookingInfo> {
  const { data: board, error: boardError } = await service
    .from("board")
    .select("owner_id")
    .eq("id", boardId)
    .maybeSingle();
  if (boardError || !board) throw new Error("Board ikke fundet.");

  const { data: members, error: membersError } = await service
    .from("board_partner")
    .select("partner_profile(app_user_id)")
    .eq("board_id", boardId);
  if (membersError) throw new Error(`Kunne ikke læse boardets partnere: ${membersError.message}`);

  const partnerUserIds = ((members ?? []) as Array<{
    partner_profile: { app_user_id: string | null } | Array<{ app_user_id: string | null }> | null;
  }>)
    .map((row) => (Array.isArray(row.partner_profile) ? row.partner_profile[0] : row.partner_profile))
    .map((profile) => profile?.app_user_id)
    .filter((id): id is string => Boolean(id));

  return { ownerUserId: (board as { owner_id: string }).owner_id, partnerUserIds };
}

/** Opret møde + deltagere i Supabase, book hos provider, hægt referencen på. */
async function createMeetingForBoard(
  service: SupabaseClient,
  boardId: string,
  startsAt: string,
): Promise<void> {
  const info = await readBoardBookingInfo(service, boardId);

  const { data: members } = await service
    .from("board_partner")
    .select("partner_id")
    .eq("board_id", boardId);
  const partnerIds = ((members ?? []) as Array<{ partner_id: string }>).map((m) => m.partner_id);
  if (partnerIds.length === 0) throw new Error("Boardet har ingen partnere at mødes med.");

  const { data: meeting, error: meetingError } = await service
    .from("meeting")
    .insert({ board_id: boardId, starts_at: startsAt })
    .select("id")
    .single();
  if (meetingError || !meeting) {
    throw new Error(`Kunne ikke oprette mødet: ${meetingError?.message ?? "ingen række skrevet"}`);
  }
  const meetingId = (meeting as { id: string }).id;

  const { error: participantsError } = await service
    .from("meeting_partner")
    .insert(partnerIds.map((partnerProfileId) => ({
      meeting_id: meetingId,
      partner_profile_id: partnerProfileId,
    })));
  if (participantsError) {
    await service.from("meeting").delete().eq("id", meetingId);
    throw new Error(`Kunne ikke tilknytte deltagere: ${participantsError.message}`);
  }

  try {
    const scheduled = await createBookingProvider().createMultiHostMeeting({
      ownerUserId: info.ownerUserId,
      partnerUserIds: info.partnerUserIds,
      startsAt,
      durationMinutes: 60,
    });
    await service
      .from("meeting")
      .update({
        provider_booking_uid: scheduled.uid,
        starts_at: scheduled.startsAt,
        video_join_url: scheduled.joinUrl || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", meetingId);
  } catch (e) {
    // Kompensér: intet halvt booket møde. Fejlen (typisk NotConfiguredError før nøgler) vises.
    await service.from("meeting").delete().eq("id", meetingId);
    throw e;
  }
}

async function requireOwnedMeeting(
  service: SupabaseClient,
  user: AuthUser,
  meetingId: string,
): Promise<{ providerBookingUid: string | null }> {
  const { data, error } = await service
    .from("meeting")
    .select("provider_booking_uid, board(owner_id)")
    .eq("id", meetingId)
    .maybeSingle();
  if (error || !data) throw new Error("Møde ikke fundet.");
  // PostgREST to-one-embed: objekt i praksis, men typeudledningen gætter array (se boards/index).
  const row = data as unknown as {
    provider_booking_uid: string | null;
    board: { owner_id: string } | Array<{ owner_id: string }> | null;
  };
  const board = Array.isArray(row.board) ? row.board[0] : row.board;
  if (!board || board.owner_id !== user.id) throw new Error("Møde ikke fundet.");
  return { providerBookingUid: row.provider_booking_uid };
}

/** Ejer booker et møde med sit board. */
export async function bookMeeting(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  try {
    const { service, user } = await requireContext("ejer");
    const boardId = String(formData.get("board_id") ?? "");
    const startsAt = String(formData.get("starts_at") ?? "");
    if (!boardId || !startsAt) return { error: "Board og starttidspunkt er påkrævet." };

    const { data: owned } = await service
      .from("board")
      .select("id")
      .eq("id", boardId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!owned) return { error: "Board ikke fundet." };

    await createMeetingForBoard(service, boardId, new Date(startsAt).toISOString());
    revalidatePath("/moeder");
    return {};
  } catch (e) {
    return toError(e);
  }
}

/**
 * Ejer flytter et møde. TODO(ejer): ændre/aflyse-vindue (byggespec §12 pkt. 4) — intet
 * vindue håndhæves; reglen tilføjes som konfiguration når den besluttes.
 */
export async function rescheduleMeeting(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const { service, user } = await requireContext("ejer");
    const meetingId = String(formData.get("meeting_id") ?? "");
    const startsAt = String(formData.get("starts_at") ?? "");
    if (!meetingId || !startsAt) return { error: "Møde og nyt starttidspunkt er påkrævet." };

    const { providerBookingUid } = await requireOwnedMeeting(service, user, meetingId);
    let confirmed = new Date(startsAt).toISOString();
    if (providerBookingUid) {
      const scheduled = await createBookingProvider().rescheduleMeeting(providerBookingUid, confirmed);
      confirmed = scheduled.startsAt;
    }

    const { error } = await service
      .from("meeting")
      .update({ starts_at: confirmed, updated_at: new Date().toISOString() })
      .eq("id", meetingId);
    if (error) return { error: `Kunne ikke flytte mødet: ${error.message}` };
    revalidatePath("/moeder");
    return {};
  } catch (e) {
    return toError(e);
  }
}

/** Ejer aflyser et møde. Provider-aflysning FØRST, så Supabase-status — ingen divergens. */
export async function cancelMeeting(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  try {
    const { service, user } = await requireContext("ejer");
    const meetingId = String(formData.get("meeting_id") ?? "");
    if (!meetingId) return { error: "Møde-id er påkrævet." };

    const { providerBookingUid } = await requireOwnedMeeting(service, user, meetingId);
    if (providerBookingUid) {
      await createBookingProvider().cancelMeeting(providerBookingUid);
    }

    const { error } = await service
      .from("meeting")
      .update({ status: "aflyst", updated_at: new Date().toISOString() })
      .eq("id", meetingId);
    if (error) return { error: `Kunne ikke aflyse mødet: ${error.message}` };
    revalidatePath("/moeder");
    return {};
  } catch (e) {
    return toError(e);
  }
}

/** Lead-partner initierer næste møde for sit board (byggespec §3: lead sikrer næste møde). */
export async function initiateNextMeeting(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const { service, user } = await requireContext("partner");
    const boardId = String(formData.get("board_id") ?? "");
    const startsAt = String(formData.get("starts_at") ?? "");
    if (!boardId || !startsAt) return { error: "Board og starttidspunkt er påkrævet." };

    // Kun boardets LEAD må initiere. is_lead-data bruges som den er (default: første interne);
    // udpegningsREGLER er stadig ejer-uafklarede og manuel markering bag flag (ADR 0022).
    const { data: lead } = await service
      .from("board_partner")
      .select("partner_id, partner_profile!inner(app_user_id)")
      .eq("board_id", boardId)
      .eq("is_lead", true)
      .eq("partner_profile.app_user_id", user.id)
      .maybeSingle();
    if (!lead) return { error: "Kun boardets lead-partner kan initiere næste møde." };

    await createMeetingForBoard(service, boardId, new Date(startsAt).toISOString());
    revalidatePath("/partner");
    revalidatePath("/moeder");
    return {};
  } catch (e) {
    return toError(e);
  }
}

const REGISTERABLE: ReadonlySet<string> = new Set(["afholdt", "forsinket_afbud", "udeblivelse"]);

/**
 * Partner registrerer sin mødestatus (byggespec §5.6) — honorargrundlaget (ADR 0026).
 * TODO(ejer): honorar ved udeblivelse/sent afbud — kun registrering, ingen konsekvens.
 */
export async function registerMeetingStatus(formData: FormData): Promise<void> {
  const { service, user } = await requireContext("partner");
  const meetingId = String(formData.get("meeting_id") ?? "");
  const status = String(formData.get("registered_status") ?? "");
  if (!meetingId || !REGISTERABLE.has(status)) throw new Error("Ugyldig statusregistrering.");

  // Ejerskab: registrering rammer KUN rækken for partnerens egen katalogpost.
  const { data: profile } = await service
    .from("partner_profile")
    .select("id")
    .eq("app_user_id", user.id)
    .maybeSingle();
  if (!profile) throw new Error("Ingen katalogpost koblet til brugeren.");

  const { data, error } = await service
    .from("meeting_partner")
    .update({
      registered_status: status as MeetingRegisteredStatus,
      registered_at: new Date().toISOString(),
    })
    .eq("meeting_id", meetingId)
    .eq("partner_profile_id", (profile as { id: string }).id)
    .select("meeting_id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke registrere status: ${error?.message ?? "ikke deltager på mødet"}`);
  }

  // Livscyklus-kobling (ADR 0026): en 'afholdt'-registrering bekræfter at mødet fandt sted →
  // planlagt→afholdt. Øvrige registreringer rører IKKE livscyklussen (konsekvens er ejer-uafklaret).
  if (status === "afholdt") {
    await service
      .from("meeting")
      .update({ status: "afholdt", updated_at: new Date().toISOString() })
      .eq("id", meetingId)
      .eq("status", "planlagt");
  }

  revalidatePath("/partner");
  revalidatePath("/moeder");
}

/** Partner skriver/erstatter sin efter-møde-note (én pr. partner pr. møde, 0012). */
export async function saveMeetingNote(formData: FormData): Promise<void> {
  const { service, user } = await requireContext("partner");
  const meetingId = String(formData.get("meeting_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!meetingId || !body) throw new Error("Møde og notetekst er påkrævet.");

  const { data: profile } = await service
    .from("partner_profile")
    .select("id")
    .eq("app_user_id", user.id)
    .maybeSingle();
  if (!profile) throw new Error("Ingen katalogpost koblet til brugeren.");
  const partnerProfileId = (profile as { id: string }).id;

  // Kun deltagere på mødet kan skrive noter til det.
  const { data: participant } = await service
    .from("meeting_partner")
    .select("meeting_id")
    .eq("meeting_id", meetingId)
    .eq("partner_profile_id", partnerProfileId)
    .maybeSingle();
  if (!participant) throw new Error("Kun mødets deltagere kan skrive noter.");

  const { data, error } = await service
    .from("meeting_note")
    .upsert(
      { meeting_id: meetingId, partner_profile_id: partnerProfileId, body },
      { onConflict: "meeting_id,partner_profile_id" },
    )
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke gemme noten: ${error?.message ?? "ingen række skrevet"}`);
  }

  revalidatePath("/partner");
}
