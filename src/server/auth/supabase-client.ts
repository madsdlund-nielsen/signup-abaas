/**
 * SDK-backet Supabase-gateway (ADR 0013). Dette er det ENESTE auth-modul der importerer
 * @supabase/* og next/headers, og det loades kun dynamisk (se createSessionProvider i
 * ./index) når Supabase Auth er konfigureret — så stub-stien (CI/tests uden nøgler) aldrig
 * trækker SDK'et eller next/headers ind.
 *
 * - Identitet læses med anon-klienten + request-cookies (@supabase/ssr). getUser() verificerer
 *   JWT'et mod Supabase, i modsætning til blot at parse cookien.
 * - Roller læses med service-role-klienten (server-only) — bypasser RLS bevidst, så opslaget
 *   virker uafhængigt af de select-egne-policies i supabase/policies/roles.sql.
 */

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import type { Role } from "./index";
import type { SupabaseAuthConfig } from "./supabase-config";
import type { SupabaseAuthGateway } from "./supabase-provider";

export function createSupabaseGateway(config: SupabaseAuthConfig): SupabaseAuthGateway {
  return {
    async getAuthUser() {
      const cookieStore = await cookies();
      const supabase = createServerClient(config.url, config.anonKey, {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
            try {
              for (const { name, value, options } of cookiesToSet) {
                cookieStore.set(name, value, options);
              }
            } catch {
              // Kaldt fra en Server Component (cookies er read-only her). Sessionslæsning
              // virker uanset; token-refresh-cookies sættes i middleware/route handlers.
            }
          },
        },
      });
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },

    async getRoles(userId: string): Promise<Role[]> {
      const service = createClient(config.url, config.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await service
        .from("user_role_assignment")
        .select("role")
        .eq("user_id", userId);
      if (error || !data) return [];
      return (data as Array<{ role: Role }>).map((row) => row.role);
    },
  };
}
