/**
 * SDK-backet Supabase-gateway (ADR 0013). Loades kun dynamisk (se createSessionProvider i
 * ./index) når Supabase Auth er konfigureret — så stub-stien (CI/tests uden nøgler) aldrig
 * trækker SDK'et eller next/headers ind.
 *
 * - Identitet: anon-klient + request-cookies; `getUser()` JWT-verificerer brugeren.
 * - Roller: service-role-klient (server-only) — bypasser RLS, så opslaget virker uafhængigt
 *   af select-egne-policies i supabase/policies/roles.sql.
 */

import type { Role } from "./index";
import type { SupabaseAuthConfig } from "./supabase-config";
import type { SupabaseAuthGateway } from "./supabase-provider";
import { createServerSupabase, createServiceSupabase } from "./supabase-server";

export function createSupabaseGateway(config: SupabaseAuthConfig): SupabaseAuthGateway {
  return {
    async getAuthUser() {
      const supabase = await createServerSupabase(config);
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },

    async getRoles(userId: string): Promise<Role[]> {
      const service = createServiceSupabase(config);
      const { data, error } = await service
        .from("user_role_assignment")
        .select("role")
        .eq("user_id", userId);
      if (error) {
        // Tavs [] her var det der gjorde "ingen rolle" svær at fejlfinde — log årsagen.
        console.error(`[auth] getRoles fejlede for ${userId}: ${error.message}`);
        return [];
      }
      if (!data) return [];
      return (data as Array<{ role: Role }>).map((row) => row.role);
    },
  };
}
