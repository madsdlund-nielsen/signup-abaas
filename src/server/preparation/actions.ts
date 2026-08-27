"use server";

/**
 * Mutationer for mødeforberedelse (Fase 4.1, ADR 0038). Writes via service-role bag rolle- +
 * EKSPLICIT ejerskabstjek — service-role bypasser RLS, så autorisationen skal stå her
 * (mønster fra meetings/actions og boards/actions).
 *
 * To skriveveje med hver sin ejer:
 *   * dagsordenspunkter  — ejeren af boardet bag mødet
 *   * forberedelsesnote  — den partner der faktisk DELTAGER i mødet
 *
 * Deltagelses-tjekket er ikke pynt: en partner der sidder på boardet, men ikke er inviteret
 * til DETTE møde, har ingen betalte forberedelsesminutter på det og skal ikke kunne skrive
 * i rummet. Boardmedlemskab alene er derfor ikke nok.
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthFormState } from "@/components/AuthForm";
import { getCurrentUser, requireRole, type AuthUser, type Role } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import type { AgendaItemKind } from "./index";

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

const AGENDA_KINDS: readonly AgendaItemKind[] = ["dagsorden", "spoergsmaal", "materiale"];

function parseKind(value: string): AgendaItemKind | null {
  return (AGENDA_KINDS as readonly string[]).includes(value) ? (value as AgendaItemKind) : null;
}

/** Mødet skal tilhøre et board som brugeren ejer. Kaster hvis ikke. */
async function requireOwnedMeeting(
  service: SupabaseClient,
  user: AuthUser,
  meetingId: string,
): Promise<void> {
  const { data } = await service
    .from("meeting")
    .select("id, board!inner(owner_id)")
    .eq("id", meetingId)
    .eq("board.owner_id", user.id)
    .maybeSingle();
  if (!data) throw new Error("Møde ikke fundet.");
}

/**
 * Den nuværende brugers katalogpost, forudsat at den DELTAGER i mødet. Returnerer
 * partner_profile_id. Kaster hvis partneren ikke er inviteret til netop dette møde.
 */
async function requireMeetingParticipant(
  service: SupabaseClient,
  user: AuthUser,
  meetingId: string,
): Promise<string> {
  const { data } = await service
    .from("meeting_partner")
    .select("partner_profile_id, partner_profile!inner(app_user_id)")
    .eq("meeting_id", meetingId)
    .eq("partner_profile.app_user_id", user.id)
    .maybeSingle();
  if (!data) throw new Error("Du deltager ikke i dette møde.");
  return (data as { partner_profile_id: string }).partner_profile_id;
}

/** Ejer tilføjer et dagsordenspunkt, et spørgsmål eller en materialehenvisning. */
export async function addAgendaItem(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const { service, user } = await requireContext("ejer");
    const meetingId = String(formData.get("meeting_id") ?? "");
    const body = String(formData.get("body") ?? "").trim();
    const kind = parseKind(String(formData.get("kind") ?? ""));

    if (!meetingId || !body) return { error: "Møde og indhold er påkrævet." };
    if (!kind) return { error: "Ukendt type forberedelsespunkt." };

    await requireOwnedMeeting(service, user, meetingId);

    // sort_order = næste ledige inden for typen. Læses her frem for at bruge en sekvens,
    // så rækkefølgen er pr. møde og pr. type — ikke global.
    const { data: last } = await service
      .from("meeting_agenda_item")
      .select("sort_order")
      .eq("meeting_id", meetingId)
      .eq("kind", kind)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = ((last as { sort_order: number } | null)?.sort_order ?? 0) + 1;

    const { error } = await service
      .from("meeting_agenda_item")
      .insert({ meeting_id: meetingId, kind, body, sort_order: sortOrder });
    if (error) return { error: `Kunne ikke gemme punktet: ${error.message}` };

    revalidatePath("/moeder");
    return {};
  } catch (e) {
    return toError(e);
  }
}

/** Ejer fjerner et dagsordenspunkt. Ejerskab tjekkes via mødet, ikke via punktets id alene. */
export async function deleteAgendaItem(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const { service, user } = await requireContext("ejer");
    const itemId = String(formData.get("item_id") ?? "");
    if (!itemId) return { error: "Punkt-id er påkrævet." };

    const { data: item } = await service
      .from("meeting_agenda_item")
      .select("meeting_id")
      .eq("id", itemId)
      .maybeSingle();
    if (!item) return { error: "Punktet findes ikke." };

    await requireOwnedMeeting(service, user, (item as { meeting_id: string }).meeting_id);

    const { error } = await service.from("meeting_agenda_item").delete().eq("id", itemId);
    if (error) return { error: `Kunne ikke slette punktet: ${error.message}` };

    revalidatePath("/moeder");
    return {};
  } catch (e) {
    return toError(e);
  }
}

/**
 * Partner gemmer sin forberedelsesnote — modstykket til de 15 betalte minutter. Upsert på
 * (meeting_id, partner_profile_id): forberedelse er ét dokument der redigeres, ikke en
 * tråd der vokser, så gentagne gemninger må ikke skabe flere rækker.
 */
export async function savePrepNote(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const { service, user } = await requireContext("partner");
    const meetingId = String(formData.get("meeting_id") ?? "");
    const body = String(formData.get("body") ?? "").trim();
    if (!meetingId || !body) return { error: "Møde og indhold er påkrævet." };

    const partnerProfileId = await requireMeetingParticipant(service, user, meetingId);

    const { error } = await service.from("meeting_prep_note").upsert(
      {
        meeting_id: meetingId,
        partner_profile_id: partnerProfileId,
        body,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "meeting_id,partner_profile_id" },
    );
    if (error) return { error: `Kunne ikke gemme forberedelsen: ${error.message}` };

    revalidatePath("/partner");
    return {};
  } catch (e) {
    return toError(e);
  }
}
