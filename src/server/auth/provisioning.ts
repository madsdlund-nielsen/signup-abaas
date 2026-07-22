/**
 * Provisionering af selv-registrerede brugere. En ejer der signer op skal have en app_user-række
 * og rollen 'ejer'. Dette KØRER MED SERVICE-ROLE (bypasser RLS) — brugere kan ikke selv-tildele
 * roller (jf. supabase/policies/roles.sql). Idempotent, så gentagne signups ikke duplikerer.
 *
 * Klienten injiceres, så logikken kan enhedstestes uden netværk (tests/CLAUDE.md — DI, ikke mocks).
 *
 * TODO(ejer): partnere/lead-partnere oprettes af admin (fase 1.4), ikke via self-signup — kun
 * 'ejer' provisioneres her.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export async function provisionOwner(
  service: SupabaseClient,
  userId: string,
  email: string,
): Promise<void> {
  const { error: userError } = await service
    .from("app_user")
    .upsert({ id: userId, email }, { onConflict: "id" });
  if (userError) throw new Error(`app_user upsert fejlede: ${userError.message}`);

  const { error: roleError } = await service
    .from("user_role_assignment")
    .upsert({ user_id: userId, role: "ejer" }, { onConflict: "user_id,role" });
  if (roleError) throw new Error(`rolletildeling fejlede: ${roleError.message}`);

  // Verificér at rollen faktisk landede. En upsert kan returnere uden fejl men uden at skrive,
  // hvis klienten ikke reelt har service-role (fx den publishable-nøgle i stedet for secret →
  // RLS blokerer). Så fanger vi den tavse fejl her i stedet for at ende med "ingen rolle".
  const { data: check, error: checkError } = await service
    .from("user_role_assignment")
    .select("role")
    .eq("user_id", userId);
  if (checkError) throw new Error(`verifikation af rolletildeling fejlede: ${checkError.message}`);
  if (!check || !check.some((row) => (row as { role: string }).role === "ejer")) {
    throw new Error(
      "rollen 'ejer' blev ikke skrevet — er SUPABASE_SERVICE_ROLE_KEY den hemmelige (sb_secret_…) " +
        "nøgle og ikke den publishable? Uden service-role blokerer RLS skrivningen.",
    );
  }
}
