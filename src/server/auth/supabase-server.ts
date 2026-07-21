/**
 * Request-scopede Supabase-klienter (server). Bruges af både SessionProvider-gateway'en og
 * auth-server-actions. Isoleret her, så next/headers + @supabase/* kun loades server-side
 * (og kun via dynamisk import fra ./index / actions, ikke i stub-/test-stien).
 */

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { SupabaseAuthConfig } from "./supabase-config";

/** Anon-klient bundet til request-cookies. Kan læse session og (i actions) sætte auth-cookies. */
export async function createServerSupabase(config: SupabaseAuthConfig): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Kaldt fra en Server Component (cookies read-only). Refresh sker i middleware.
        }
      },
    },
  });
}

/** Service-role-klient (server-only). Bypasser RLS bevidst — kun til admin-/provisionering. */
export function createServiceSupabase(config: SupabaseAuthConfig): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
