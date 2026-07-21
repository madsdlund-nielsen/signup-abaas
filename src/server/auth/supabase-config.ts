/**
 * Konfiguration for Supabase Auth (ADR 0013). Ren env-læsning — importerer bevidst
 * INGEN SDK, så den kan bruges i factoryen og i tests uden at trække @supabase/* eller
 * next/headers ind. Mønster spejler readConfig/isConfigured i src/lib/<vendor>/index.ts.
 */

export interface SupabaseAuthConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

type PartialConfig = {
  url: string | undefined;
  anonKey: string | undefined;
  serviceRoleKey: string | undefined;
};

export function readSupabaseAuthConfig(
  env: Record<string, string | undefined> = process.env,
): PartialConfig {
  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    // Server-only hemmelighed — ALDRIG NEXT_PUBLIC_. Bruges kun server-side til rolle-opslag.
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function isSupabaseAuthConfigured(config: PartialConfig): config is SupabaseAuthConfig {
  return Boolean(config.url && config.anonKey && config.serviceRoleKey);
}
