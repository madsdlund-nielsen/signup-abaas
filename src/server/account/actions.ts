"use server";

/**
 * Kontoprofilens skrivevej (skive K, ADR 0061). Service-role bag `getCurrentUser` + EKSPLICIT
 * ejerskab: rækken der opdateres er brugerens EGEN (`id = den nuværende bruger`) — id'et kommer
 * aldrig fra formularen. `app_user` har ingen write-policy (en direkte PostgREST-skrivning
 * kunne ellers også ændre e-mail), så skrivningen går her, som resten af repoets writes.
 *
 * Alle roller må redigere deres egen konto: ejere, partnere og admin. En partners navn i
 * kataloget (`partner_profile.name`) er et andet felt og røres ikke herfra.
 *
 * TODO(ejer): samtykketeksten til SMS (og ToS) — teksten på siden er en teknisk pladsholder,
 * ikke godkendt juridisk ordlyd (docs/stub-register.md).
 */

import { revalidatePath } from "next/cache";

import type { AuthFormState } from "@/components/AuthForm";
import { getCurrentUser } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";

import { parseProfileInput, smsConsentStamp } from "./validation";

export async function saveAccountProfile(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  try {
    const config = readSupabaseAuthConfig();
    if (!isSupabaseAuthConfigured(config)) return { error: "Supabase er ikke konfigureret." };
    const user = await getCurrentUser();
    if (!user) return { error: "Du skal være logget ind for at gemme din konto." };

    const parsed = parseProfileInput({
      displayName: String(formData.get("display_name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      timeZone: String(formData.get("time_zone") ?? ""),
      // En afkrydsning er kun et ja når den står i formularen; mangler feltet, er svaret nej.
      smsOptIn: formData.get("sms_opt_in") === "on",
    });
    if (!parsed.ok) return { error: parsed.error };

    const service = createServiceSupabase(config);
    const { data: stored, error: readError } = await service
      .from("app_user")
      .select("phone_e164, sms_opt_in, sms_opt_in_at")
      .eq("id", user.id)
      .maybeSingle();
    if (readError) return { error: "Kunne ikke læse din konto. Prøv igen." };
    if (!stored) return { error: "Din konto blev ikke fundet." };
    const row = stored as { phone_e164: string | null; sms_opt_in: boolean; sms_opt_in_at: string | null };

    const { profile } = parsed;
    const smsOptInAt = smsConsentStamp(
      profile,
      { phone: row.phone_e164, smsOptIn: row.sms_opt_in, smsOptInAt: row.sms_opt_in_at },
      new Date(),
    );

    const { error } = await service
      .from("app_user")
      .update({
        display_name: profile.displayName,
        phone_e164: profile.phone,
        time_zone: profile.timeZone,
        sms_opt_in: profile.smsOptIn,
        sms_opt_in_at: smsOptInAt,
      })
      .eq("id", user.id);
    if (error) {
      // Databasens beskrivelse kan citere værdier (telefon); log kun at det skete.
      console.error(`[account] saveAccountProfile fejlede (kode ${error.code ?? "ukendt"})`);
      return { error: "Kunne ikke gemme din konto. Prøv igen." };
    }

    revalidatePath("/konto");
    return { notice: "Din konto er gemt." };
  } catch (e) {
    console.error(`[account] saveAccountProfile fejlede: ${e instanceof Error ? e.name : "ukendt fejl"}`);
    return { error: "Kunne ikke gemme din konto. Prøv igen." };
  }
}
