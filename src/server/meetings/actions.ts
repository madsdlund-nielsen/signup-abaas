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
import { createBookingProvider, type BookingAttendee, type BookingProvider } from "@/lib/booking";
import { createChargeForMeeting } from "@/server/charges/create";
import { assertBoardAvailable, assertMeetingBoardAvailable } from "@/server/availability/guard";
import { copenhagenLocalToIso } from "@/server/time/copenhagen";
import { ownerAttendee, resolveEventTypeId } from "./booking-info";
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
  /** Boardets collective event type (`board.calcom_event_type_id`, 0019) — værterne hører til det. */
  eventTypeId: number;
  /** Ejeren som Cal.com-attendee (ét objekt, ikke et bruger-id — ADR 0046). */
  attendee: BookingAttendee;
}

async function readBoardBookingInfo(
  service: SupabaseClient,
  boardId: string,
  provider: BookingProvider,
): Promise<BoardBookingInfo> {
  const { data: board, error: boardError } = await service
    .from("board")
    .select("owner_id, calcom_event_type_id")
    .eq("id", boardId)
    .maybeSingle();
  if (boardError || !board) throw new Error("Board ikke fundet.");
  const row = board as { owner_id: string; calcom_event_type_id: number | null };

  // Højlydt fejl i rigtig tilstand hvis boardet mangler event type (demo: falsk id). Før
  // ejer-opslaget, så intet læses unødigt — og før mødet oprettes i Supabase.
  const eventTypeId = resolveEventTypeId(provider, row.calcom_event_type_id);

  const { data: owner, error: ownerError } = await service
    .from("app_user")
    .select("email")
    .eq("id", row.owner_id)
    .maybeSingle();
  if (ownerError || !owner) throw new Error("Ejerens kontaktoplysninger kunne ikke læses.");

  return { eventTypeId, attendee: ownerAttendee((owner as { email: string }).email) };
}

/** Opret møde + deltagere i Supabase, book hos provider, hægt referencen på. */
async function createMeetingForBoard(
  service: SupabaseClient,
  boardId: string,
  startsAt: string,
): Promise<void> {
  // Partner-tilgængelighed (fase 5.3, ADR 0052): afvis før noget skrives.
  await assertBoardAvailable(service, boardId, startsAt);
  const booking = createBookingProvider();
  const info = await readBoardBookingInfo(service, boardId, booking);

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
    const scheduled = await booking.createMultiHostMeeting({
      eventTypeId: info.eventTypeId,
      start: startsAt,
      attendee: info.attendee,
      metadata: { abaasMeetingId: meetingId, abaasBoardId: boardId },
    });
    const { error: attachError } = await service
      .from("meeting")
      .update({
        provider_booking_uid: scheduled.uid,
        starts_at: scheduled.startsAt,
        video_join_url: scheduled.joinUrl || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", meetingId);
    // Fejler DENNE skrivning, findes bookingen hos Cal.com uden at Supabase kender dens
    // uid: alle webhooks for den ville ryge i "ukendt uid → ignoreret", og mødet ville
    // divergere fra sandhedskilden i det stille. Kompensér hos provideren i stedet.
    if (attachError) {
      await booking
        .cancelMeeting(scheduled.uid, "Bookingreferencen kunne ikke gemmes i ABaaS")
        .catch(() => {
          /* provider-oprydning er best-effort; den rigtige fejl er attachError nedenfor */
        });
      throw new Error(`Kunne ikke gemme bookingreferencen: ${attachError.message}`);
    }
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

    await createMeetingForBoard(service, boardId, copenhagenLocalToIso(startsAt));
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
    let confirmed = copenhagenLocalToIso(startsAt); // B-29: dansk vægurstid, ikke serverens zone
    await assertMeetingBoardAvailable(service, meetingId, confirmed); // fase 5.3, ADR 0052
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

    await createMeetingForBoard(service, boardId, copenhagenLocalToIso(startsAt));
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
    const { data: flipped } = await service
      .from("meeting")
      .update({ status: "afholdt", updated_at: new Date().toISOString() })
      .eq("id", meetingId)
      .eq("status", "planlagt")
      .select("id");
    // Charge-grundlag KUN fra den registrering der faktisk flippede (ADR 0030) — ellers
    // ville N partneres registreringer give N forsøg. `meeting_id unique` er andet lag.
    // createChargeForMeeting kaster aldrig; partnerens registrering afhænger ikke af betaling.
    if (flipped && flipped.length > 0) {
      await createChargeForMeeting(service, meetingId);
    }
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
