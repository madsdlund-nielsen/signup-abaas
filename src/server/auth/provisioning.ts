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
}
