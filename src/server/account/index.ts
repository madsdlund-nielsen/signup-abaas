/**
 * Kontoprofilens læsevej (skive K, ADR 0061). Authed klient — RLS-policyen `app_user_select_self`
 * (0006) scoper til brugerens egen række. Forespørgslen filtrerer ALLIGEVEL eksplicit på
 * brugerens id: siden 0024 har admin også en select-policy på `app_user`, og en admin der åbner
 * sin egen konto skal ikke se en tilfældig anden brugers række.
 *
 * Ukonfigureret Supabase → null (kontofri CI/dev).
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

import { DEFAULT_TIME_ZONE } from "./validation";

export interface AccountProfile {
  email: string;
  displayName: string | null;
  phone: string | null;
  timeZone: string;
}

export interface AccountRow {
  email: string;
  display_name: string | null;
  phone_e164: string | null;
  time_zone: string | null;
}

/** Kolonnerne en profil-læsning henter — delt med skrivevejen, så de to ikke driver fra hinanden. */
export const ACCOUNT_COLUMNS = "email, display_name, phone_e164, time_zone";

export function toAccountProfile(row: AccountRow): AccountProfile {
  return {
    email: row.email,
    displayName: row.display_name,
    phone: row.phone_e164,
    timeZone: row.time_zone ?? DEFAULT_TIME_ZONE,
  };
}

/** Den nuværende brugers egen profil, eller null (ikke logget ind / Supabase ikke konfigureret). */
export async function getMyAccount(
  env: Record<string, string | undefined> = process.env,
): Promise<AccountProfile | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;

  const supabase = await createServerSupabase(config);
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return null;

  const { data, error } = await supabase
    .from("app_user")
    .select(ACCOUNT_COLUMNS)
    .eq("id", uid)
    .maybeSingle();
  if (error) {
    console.error(`[account] getMyAccount fejlede: ${error.message}`);
    return null;
  }
  return data ? toAccountProfile(data as unknown as AccountRow) : null;
}
