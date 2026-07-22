/**
 * Adgangsport (ADR 0020): en enkelt DELT adgangskode FØR auth, så tilfældige besøgende ikke kan nå
 * app/login under den lukkede ejer-test. Konfigureres via server-only env-vars (aldrig NEXT_PUBLIC,
 * aldrig i repoet/DB). Slukket når `APP_GATE_ENABLED` ikke er "true" → CI/dev upåvirket.
 *
 * Fail-open ved delvis konfiguration: er porten "enabled" men mangler hash/secret, logges en advarsel
 * og porten er inaktiv (frem for at låse alle ude, inkl. admin). Sæt alle tre vars samtidig.
 */

export const GATE_COOKIE = "app_gate";

export interface GateConfig {
  enabled: boolean;
  passwordHash: string | null;
  cookieSecret: string | null;
}

export function readGateConfig(env: Record<string, string | undefined> = process.env): GateConfig {
  return {
    enabled: env.APP_GATE_ENABLED === "true",
    passwordHash: env.APP_GATE_PASSWORD_HASH ?? null,
    cookieSecret: env.APP_GATE_COOKIE_SECRET ?? null,
  };
}

/** Er porten aktiv (enabled + fuldt konfigureret)? Ellers slip igennem (se fail-open ovenfor). */
export function isGateActive(config: GateConfig): boolean {
  return config.enabled && config.passwordHash !== null && config.cookieSecret !== null;
}
