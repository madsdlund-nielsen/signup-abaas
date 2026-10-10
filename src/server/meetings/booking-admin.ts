"use server";

/**
 * Admin-handlinger til Cal.com-koblingen (ADR 0046, B-23): partner ↔ Cal.com-bruger (Teams-sæde)
 * og boardets collective event type. Writes via service-role bag requireRole('admin') med
 * .select()-readback — samme mønster som partner-/quiz-actions. Der findes ingen write-policies
 * på hverken `board` eller `partner_profile` (0019), så ejer/partner kan ikke nå kolonnerne.
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthFormState } from "@/components/AuthForm";
import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { createBookingProvider } from "@/lib/booking";
import { MEETING_LENGTH_MINUTES } from "./booking-info";

async function requireAdminService(): Promise<SupabaseClient> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  requireRole(await getCurrentUser(), "admin");
  return createServiceSupabase(config);
}

function toError(e: unknown): AuthFormState {
  return { error: e instanceof Error ? e.message : String(e) };
}

/** Tom streng → null (fjern koblingen); ellers et positivt heltal (Cal.com-id'er er heltal). */
function parseCalcomId(raw: FormDataEntryValue | null, label: string): number | null {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} skal være et positivt heltal.`);
  return n;
}

/** Postgres unique_violation → dansk besked (to partnere kan ikke dele et Cal.com-sæde). */
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

/** Admin kobler en katalogpartner til sit Cal.com-sæde (tom = fjern koblingen). */
export async function setPartnerCalcomUserId(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const service = await requireAdminService();
    const partnerId = String(formData.get("partner_id") ?? "");
    if (!partnerId) return { error: "Partner-id er påkrævet." };
    const calcomUserId = parseCalcomId(formData.get("calcom_user_id"), "Cal.com-bruger-id");

    const { data, error } = await service
      .from("partner_profile")
      .update({ calcom_user_id: calcomUserId, updated_at: new Date().toISOString() })
      .eq("id", partnerId)
      .select("id")
      .maybeSingle();
    if (isUniqueViolation(error)) {
      return { error: "Et andet katalogmedlem er allerede koblet til det Cal.com-bruger-id." };
    }
    if (error || !data) {
      return { error: `Kunne ikke gemme Cal.com-bruger: ${error?.message ?? "partner ikke fundet"}` };
    }
    revalidatePath(`/admin/partners/${partnerId}`);
    revalidatePath("/admin/boards");
    return {};
  } catch (e) {
    return toError(e);
  }
}

/**
 * Admin opretter (eller genskriver hosts på) boardets collective event type hos Cal.com og
 * gemmer id'et på boardet. Hosts = boardets partnere via `partner_profile.calcom_user_id`; en
 * partner uden Cal.com-bruger gør handlingen til en højlydt fejl frem for et board med færre
 * værter end partnere (stub-politik: plausibelt, men forkert).
 *
 * TODO(mads): board-livscyklus — en partnerudskiftning skal opdatere event typens hosts. Indtil
 * da genkøres denne handling manuelt (den er idempotent: eksisterende id → opdatér).
 */
export async function createBoardEventType(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const service = await requireAdminService();
    const boardId = String(formData.get("board_id") ?? "");
    if (!boardId) return { error: "Board-id er påkrævet." };

    const { data: board, error: boardError } = await service
      .from("board")
      .select("id, name, calcom_event_type_id")
      .eq("id", boardId)
      .maybeSingle();
    if (boardError || !board) return { error: "Board ikke fundet." };
    const boardRow = board as { id: string; name: string; calcom_event_type_id: number | null };

    const { data: members, error: membersError } = await service
      .from("board_partner")
      .select("partner_profile(name, calcom_user_id)")
      .eq("board_id", boardId);
    if (membersError) return { error: `Kunne ikke læse boardets partnere: ${membersError.message}` };

    const profiles = ((members ?? []) as unknown as Array<{
      partner_profile:
        | { name: string; calcom_user_id: number | null }
        | Array<{ name: string; calcom_user_id: number | null }>
        | null;
    }>)
      .map((m) => (Array.isArray(m.partner_profile) ? m.partner_profile[0] : m.partner_profile))
      .filter((p): p is { name: string; calcom_user_id: number | null } => p != null);

    if (profiles.length === 0) return { error: "Boardet har ingen partnere at gøre til værter." };
    const missing = profiles.filter((p) => p.calcom_user_id == null).map((p) => p.name);
    if (missing.length > 0) {
      return {
        error:
          `Disse partnere mangler et Cal.com-bruger-id og kan ikke være værter: ${missing.join(", ")}. ` +
          `Indtast det på partnerens side først (admin → partner-katalog).`,
      };
    }

    const booking = createBookingProvider();
    const { eventTypeId } = await booking.upsertBoardEventType({
      eventTypeId: boardRow.calcom_event_type_id,
      title: boardRow.name,
      // Stabil og unik pr. board uden at lække navne i URL'en.
      slug: `abaas-board-${boardRow.id}`,
      lengthInMinutes: MEETING_LENGTH_MINUTES,
      hostUserIds: profiles.map((p) => p.calcom_user_id as number),
    });

    // Demo-id'et ville ellers blive sendt til en rigtig Cal.com den dag nøglerne lander.
    if (booking.name === "demo") {
      return {
        error:
          "[DEMO] Demo-tilstand: der er ikke oprettet noget event type hos Cal.com, og det falske id er " +
          "ikke gemt. Boardet bookes med et falsk demo-id.",
      };
    }

    const { data: saved, error: saveError } = await service
      .from("board")
      .update({ calcom_event_type_id: eventTypeId })
      .eq("id", boardId)
      .select("id")
      .maybeSingle();
    if (isUniqueViolation(saveError)) {
      return { error: "Det Cal.com event type er allerede knyttet til et andet board." };
    }
    if (saveError || !saved) {
      return {
        error:
          `Event typen blev oprettet hos Cal.com (id ${eventTypeId}), men kunne ikke gemmes på boardet: ` +
          `${saveError?.message ?? "board ikke fundet"}. Genkør handlingen eller indtast id'et manuelt.`,
      };
    }

    revalidatePath("/admin/boards");
    return {};
  } catch (e) {
    return toError(e);
  }
}
