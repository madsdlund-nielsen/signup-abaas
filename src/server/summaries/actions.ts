"use server";

/**
 * "Generér igen" for en opsummering der er opgivet (`fejlet`) — fase 4.4, B-45, ADR 0059.
 * Write via service-role bag rolle- + EKSPLICIT ejerskabstjek (service-role bypasser RLS, så
 * autorisationen står her; mønster fra preparation/actions).
 *
 * Handlingen genererer IKKE selv: den sætter kun rækken tilbage til `afventer` med nulstillede
 * forsøg, og baggrundskørslen (samme samtykke- og låsemekanik som altid) samler den op. Siden
 * kan derfor aldrig udløse et betalt kald synkront eller omgå samtykket.
 */

import { revalidatePath } from "next/cache";

import type { AuthFormState } from "@/components/AuthForm";
import { getCurrentUser, requireRole } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";

export async function retryMeetingSummary(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const config = readSupabaseAuthConfig();
    if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
    const user = requireRole(await getCurrentUser(), "ejer");
    const service = createServiceSupabase(config);

    const meetingId = String(formData.get("meeting_id") ?? "");
    if (!meetingId) return { error: "Møde-id er påkrævet." };

    // Mødet skal tilhøre et board som brugeren ejer.
    const { data: owned } = await service
      .from("meeting")
      .select("id, board!inner(owner_id)")
      .eq("id", meetingId)
      .eq("board.owner_id", user.id)
      .maybeSingle();
    if (!owned) return { error: "Møde ikke fundet." };

    // Kun en opgivet række kan prøves igen — betinget, så en kørsel i gang ikke forstyrres.
    const { data, error } = await service
      .from("meeting_summary")
      .update({ status: "afventer", attempts: 0, error: null, updated_at: new Date().toISOString() })
      .eq("meeting_id", meetingId)
      .eq("status", "fejlet")
      .select("id");
    if (error) return { error: `Kunne ikke sætte opsummeringen i gang: ${error.message}` };
    if ((data ?? []).length === 0) return { error: "Opsummeringen kan ikke genereres igen lige nu." };

    revalidatePath(`/moeder/${meetingId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
