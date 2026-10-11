/**
 * Testbrugere og hjælpere der skriver direkte i den lokale Supabase (service-role). Bruges KUN til
 * opsætning og kontrol — selve rejserne klikkes i browseren. Adgangskoden er åbenlyst lokal.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadSupabaseEnv } from "./env";

export const E2E_PASSWORD = "e2e-kun-lokalt-Pass-1";

export const USERS = {
  /** Gennemspiller hele rejsen i browseren: signup → quiz → board → møde → betaling. */
  ejer: "ejer-rejse@e2e.test",
  /** Har en befolket tilstand fra demo-seed'et (board, kort, afholdt + kommende møde). */
  ejerBefolket: "ejer-befolket@e2e.test",
  admin: "admin@e2e.test",
  partner: "partner@e2e.test",
} as const;

let admin: SupabaseClient | undefined;

/** Service-role-klient. Aldrig i browseren, aldrig i appens kode. */
export function serviceClient(): SupabaseClient {
  if (!admin) {
    const env = loadSupabaseEnv();
    admin = createClient(env.apiUrl, env.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return admin;
}

/** Opret (eller find) en bekræftet auth-bruger med den givne rolle, spejlet i app_user. */
export async function ensureUser(email: string, role: "ejer" | "admin" | "partner"): Promise<string> {
  const service = serviceClient();
  const created = await service.auth.admin.createUser({
    email,
    password: E2E_PASSWORD,
    email_confirm: true,
  });
  let userId = created.data.user?.id;
  if (!userId) {
    // Findes allerede (kørsel uden databasenulstilling) — slå op og nulstil adgangskoden.
    const list = await service.auth.admin.listUsers({ perPage: 1000 });
    const existing = list.data.users.find((u) => u.email === email);
    if (!existing) throw new Error(`Kunne ikke oprette ${email}: ${created.error?.message}`);
    userId = existing.id;
    await service.auth.admin.updateUserById(userId, { password: E2E_PASSWORD, email_confirm: true });
  }

  const appUser = await service.from("app_user").upsert({ id: userId, email }, { onConflict: "id" });
  if (appUser.error) throw new Error(`app_user: ${appUser.error.message}`);
  const assignment = await service
    .from("user_role_assignment")
    .upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
  if (assignment.error) throw new Error(`user_role_assignment: ${assignment.error.message}`);
  return userId;
}

/** Id'et på en bruger via e-mail (null hvis ukendt). */
export async function userIdByEmail(email: string): Promise<string | null> {
  const { data } = await serviceClient().from("app_user").select("id").eq("email", email).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Starttidspunkt til booking: næste tirsdag mindst ~10 dage frem, kl. 10:00 dansk tid (datetime-local). */
export function futureBookingSlot(daysAhead = 10): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  while (date.getUTCDay() !== 2) date.setUTCDate(date.getUTCDate() + 1);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T10:00`;
}
