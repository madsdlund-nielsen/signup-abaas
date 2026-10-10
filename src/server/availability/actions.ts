"use server";

/**
 * Partnerens egen tilgængelighed (fase 5.3, ADR 0052). Service-role bag requireRole('partner')
 * + EKSPLICIT ejerskabstjek: profilen slås op via `app_user_id = den nuværende bruger`, og
 * enhver sletning er afgrænset til den profils id — service-role bypasser RLS, så ejerskabet
 * verificeres her (mønster fra src/server/partners/self-actions.ts). Tabellerne har ingen
 * write-policies (0018).
 *
 * Ingen forretningstal: en partner skriver sine EGNE tider. Valideringen ligger i ./validation.
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthFormState } from "@/components/AuthForm";
import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";

import { parseAbsenceInput, parseSlotInput } from "./validation";

interface MyContext {
  service: SupabaseClient;
  partnerProfileId: string;
}

async function requireMyContext(): Promise<MyContext> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  const user = requireRole(await getCurrentUser(), "partner");
  const service = createServiceSupabase(config);

  const { data: profile } = await service
    .from("partner_profile")
    .select("id")
    .eq("app_user_id", user.id)
    .maybeSingle();
  if (!profile) throw new Error("Ingen katalogpost koblet til brugeren.");
  return { service, partnerProfileId: (profile as { id: string }).id };
}

function toError(e: unknown): AuthFormState {
  return { error: e instanceof Error ? e.message : String(e) };
}

function refresh(): void {
  revalidatePath("/partner/tilgaengelighed");
  revalidatePath("/moeder");
}

/** Tilføj det samme tidsvindue på én eller flere ugedage. Identiske vinduer ignoreres. */
export async function addAvailabilitySlots(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const { service, partnerProfileId } = await requireMyContext();
    const input = parseSlotInput({
      weekdays: formData.getAll("weekday").map(String),
      startTime: String(formData.get("start_time") ?? ""),
      endTime: String(formData.get("end_time") ?? ""),
    });

    const { error } = await service.from("partner_availability").upsert(
      input.weekdays.map((weekday) => ({
        partner_profile_id: partnerProfileId,
        weekday,
        start_time: input.startTime,
        end_time: input.endTime,
      })),
      { onConflict: "partner_profile_id,weekday,start_time,end_time", ignoreDuplicates: true },
    );
    if (error) return { error: `Kunne ikke gemme tiderne: ${error.message}` };

    refresh();
    return {};
  } catch (e) {
    return toError(e);
  }
}

/** Fjern ét af partnerens egne ugevinduer. */
export async function removeAvailabilitySlot(formData: FormData): Promise<void> {
  const { service, partnerProfileId } = await requireMyContext();
  const id = String(formData.get("slot_id") ?? "");
  if (!id) throw new Error("Vindue-id er påkrævet.");

  const { data, error } = await service
    .from("partner_availability")
    .delete()
    .eq("id", id)
    .eq("partner_profile_id", partnerProfileId)
    .select("id");
  if (error) throw new Error(`Kunne ikke fjerne tidsvinduet: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Tidsvindue ikke fundet.");

  refresh();
}

/** Registrér en fraværsperiode (hele dage, begge ender inklusive). */
export async function addAbsence(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  try {
    const { service, partnerProfileId } = await requireMyContext();
    const input = parseAbsenceInput({
      startsOn: String(formData.get("starts_on") ?? ""),
      endsOn: String(formData.get("ends_on") ?? ""),
      note: String(formData.get("note") ?? ""),
    });

    const { error } = await service.from("partner_absence").insert({
      partner_profile_id: partnerProfileId,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      note: input.note,
    });
    if (error) return { error: `Kunne ikke gemme fraværet: ${error.message}` };

    refresh();
    return {};
  } catch (e) {
    return toError(e);
  }
}

/** Fjern en af partnerens egne fraværsperioder. */
export async function removeAbsence(formData: FormData): Promise<void> {
  const { service, partnerProfileId } = await requireMyContext();
  const id = String(formData.get("absence_id") ?? "");
  if (!id) throw new Error("Fravær-id er påkrævet.");

  const { data, error } = await service
    .from("partner_absence")
    .delete()
    .eq("id", id)
    .eq("partner_profile_id", partnerProfileId)
    .select("id");
  if (error) throw new Error(`Kunne ikke fjerne fraværet: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Fravær ikke fundet.");

  refresh();
}
