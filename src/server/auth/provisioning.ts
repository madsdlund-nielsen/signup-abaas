/**
 * Provisionering af brugere. Ejer selv-registrerer (provisionOwner, fase 1.1); partnere
 * INVITERES af admin og provisioneres her med kobling til deres katalogpost
 * (provisionPartner, fase 2.8, ADR 0025). Begge KØRER MED SERVICE-ROLE (bypasser RLS) —
 * brugere kan ikke selv-tildele roller. Idempotente, så gentagne kald ikke duplikerer.
 *
 * Klienten injiceres, så logikken kan enhedstestes uden netværk (tests/CLAUDE.md — DI, ikke mocks).
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

/**
 * Provisionér en inviteret partner: app_user-række, rollen 'partner', og koblingen
 * katalogpost ↔ auth-bruger (partner_profile.app_user_id, 0011). Nægter at stjæle en
 * katalogpost der allerede er koblet til en ANDEN bruger — det ville flytte board-adgang.
 */
export async function provisionPartner(
  service: SupabaseClient,
  userId: string,
  email: string,
  partnerProfileId: string,
): Promise<void> {
  const { data: profile, error: profileError } = await service
    .from("partner_profile")
    .select("id, app_user_id")
    .eq("id", partnerProfileId)
    .maybeSingle();
  if (profileError) throw new Error(`opslag af katalogpost fejlede: ${profileError.message}`);
  if (!profile) throw new Error("katalogposten findes ikke.");
  const existing = (profile as { app_user_id: string | null }).app_user_id;
  if (existing && existing !== userId) {
    throw new Error("katalogposten er allerede koblet til en anden bruger.");
  }

  const { error: userError } = await service
    .from("app_user")
    .upsert({ id: userId, email }, { onConflict: "id" });
  if (userError) throw new Error(`app_user upsert fejlede: ${userError.message}`);

  const { error: roleError } = await service
    .from("user_role_assignment")
    .upsert({ user_id: userId, role: "partner" }, { onConflict: "user_id,role" });
  if (roleError) throw new Error(`rolletildeling fejlede: ${roleError.message}`);

  const { data: linked, error: linkError } = await service
    .from("partner_profile")
    .update({ app_user_id: userId, updated_at: new Date().toISOString() })
    .eq("id", partnerProfileId)
    .select("app_user_id")
    .single();
  if (linkError || !linked) {
    throw new Error(`kobling katalogpost↔bruger fejlede: ${linkError?.message ?? "ingen række ramt"}`);
  }

  // Verify-readback som provisionOwner: fang tavs RLS-blokering (forkert nøgletype).
  const { data: check, error: checkError } = await service
    .from("user_role_assignment")
    .select("role")
    .eq("user_id", userId);
  if (checkError) throw new Error(`verifikation af rolletildeling fejlede: ${checkError.message}`);
  if (!check || !check.some((row) => (row as { role: string }).role === "partner")) {
    throw new Error(
      "rollen 'partner' blev ikke skrevet — er SUPABASE_SERVICE_ROLE_KEY den hemmelige " +
        "(sb_secret_…) nøgle og ikke den publishable? Uden service-role blokerer RLS skrivningen.",
    );
  }
}
