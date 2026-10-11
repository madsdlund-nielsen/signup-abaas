/**
 * Grundlaget for mødeoptagelse og AI-behandling af et møde (fase 4.3/4.4, ADR 0058, 0059, 0065).
 *
 * Beslutning (Mads, 2026-10-11, ADR 0065): samtykke til optagelse, AI-behandling og SMS er en del
 * af KONTRAKTINDGÅELSEN. Der er ingen opt-in/out-håndtag på platformen — ingen tabel, ingen UI,
 * ingen tilbagekaldelse. Grundlaget for et møde der findes på platformen er derfor kontrakten
 * (`basis: "kontrakt"`); et møde der ikke findes har intet grundlag, og kodestien fejler lukket
 * (`null` → `mangler_samtykke`, `RecordingConsentMissingError`).
 *
 * Det der IKKE er ændret: adapteren (`src/lib/transcription/ordbogen.ts`) kræver stadig et
 * `consent`-objekt for netop dette møde, og kalderen (`summaries/generate.ts`) tjekker det før
 * lyden hentes. Det er defense-in-depth — det leveres nu bare. Transskription er stadig bag
 * `FLAG_TRANSCRIPTION` + nøgle, og selve optagelsen (`summaries/recording.ts`, spike L-8) er stadig
 * et hul. Kontrakten som sådan (ToS + honoraraftale, og at den dækker optagelse, AI og SMS) er
 * ejerens indhold — se TODO nedenfor.
 *
 * Server-only: bruger service-role (bypasser RLS bevidst — opslaget er "findes mødet?", ikke
 * en brugerhandling) og kaldes fra baggrundskørslen. Ukonfigureret Supabase → `null`.
 *
 * TODO(ejer): kontrakten (ToS + honoraraftale) skal skrives så den også dækker samtykke til
 * mødeoptagelse, AI-behandling (Ordbogen) og SMS. Platformen forudsætter at den er indgået.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { RecordingConsent } from "@/lib/transcription";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";

export async function getRecordingConsent(
  meetingId: string,
  service?: SupabaseClient,
): Promise<RecordingConsent | null> {
  let client = service;
  if (!client) {
    const config = readSupabaseAuthConfig();
    if (!isSupabaseAuthConfigured(config)) return null;
    client = createServiceSupabase(config);
  }

  const { data, error } = await client.from("meeting").select("id").eq("id", meetingId).maybeSingle();
  if (error) {
    // Fejler lukket: en læsefejl er ikke et grundlag. Ingen persondata i loggen — kun mødets id.
    console.error(`[consent] getRecordingConsent fejlede for møde ${meetingId}: ${error.message}`);
    return null;
  }
  if (!data) return null;
  return { meetingId, basis: "kontrakt" };
}
