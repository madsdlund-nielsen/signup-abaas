/**
 * Provider-agnostisk auth-abstraktion (fase 0).
 *
 * Auth-LEVERANDØREN er afgjort: Supabase Auth (ADR 0013). Denne port lader features
 * og domænekode tale om "den nuværende bruger" og roller uden at binde sig til
 * leverandøren. RLS hænger på rolle-relationen i databasen, ikke på auth-leverandøren.
 *
 * createSessionProvider() vælger implementering ud fra env (samme mønster som
 * adapterne i src/lib): er Supabase Auth konfigureret, bruges SupabaseSessionProvider;
 * ellers StubSessionProvider (kontofri CI/tests). Registrér på serveren via
 * registerSessionProvider().
 */

import { cache } from "react";

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "./supabase-config";
import { SupabaseSessionProvider } from "./supabase-provider";

export type Role = "ejer" | "partner" | "lead_partner" | "admin";

export interface AuthUser {
  /** Svarer til auth.uid() / Supabase auth.users.id. */
  id: string;
  email: string;
  roles: Role[];
}

export interface SessionProvider {
  readonly name: string;
  /** Nuværende bruger, eller null hvis ikke logget ind. */
  getCurrentUser(): Promise<AuthUser | null>;
}

/** Stub indtil auth-spiken er afgjort: ingen leverandør → ingen session. */
export class StubSessionProvider implements SessionProvider {
  readonly name = "stub";
  async getCurrentUser(): Promise<AuthUser | null> {
    return null;
  }
}

export function requireRole(user: AuthUser | null, role: Role): AuthUser {
  if (!user || !user.roles.includes(role)) {
    throw new Error(`Adgang nægtet: kræver rollen '${role}'.`);
  }
  return user;
}

let provider: SessionProvider = new StubSessionProvider();

export function getSessionProvider(): SessionProvider {
  return provider;
}

export function setSessionProvider(next: SessionProvider): void {
  provider = next;
}

/**
 * Vælg SessionProvider ud fra env. Supabase Auth når URL + anon-nøgle + service-role
 * er sat, ellers stub. SDK'et loades kun dynamisk (og først ved getCurrentUser), så
 * stub-stien aldrig trækker @supabase/* eller next/headers ind.
 */
export function createSessionProvider(
  env: Record<string, string | undefined> = process.env,
): SessionProvider {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) {
    return new StubSessionProvider();
  }
  return new SupabaseSessionProvider(async () => {
    const { createSupabaseGateway } = await import("./supabase-client");
    return createSupabaseGateway(config);
  });
}

/** Byg og registrér den valgte provider (kald én gang i server-bootstrap). */
export function registerSessionProvider(
  env: Record<string, string | undefined> = process.env,
): SessionProvider {
  const next = createSessionProvider(env);
  setSessionProvider(next);
  return next;
}

/**
 * Request-scopet memoisering af brugeropslaget (ADR 0049).
 *
 * Ét sideskift spurgte før om den samme bruger 2-4 gange — SiteHeader i rodlayoutet,
 * rolle-guarden i et segment-layout, siden selv, og hver server-reader der kalder
 * requireRole. Hvert opslag er TO netværkskald til Supabase (JWT-verifikation +
 * rolleopslag), så duplikaterne lå på den kritiske vej før noget blev renderet.
 *
 * `cache` fra React deler resultatet inden for ÉT render-pass og intet derudover:
 * uden for et render-scope (server-actions uden for render, tests, scripts) memoiserer
 * den slet ikke og kalder bare igennem — verificeret, ikke antaget. Der findes derfor
 * ingen modul-global cache som kunne bære én brugers session over i en anden requests
 * render. Det er hele grunden til at netop dette greb er forsvarligt på autorisationslaget.
 *
 * Semantikken er uændret: samme JWT-verifikation, samme rolleopslag, samme svar.
 * Kun antallet af gange det sker pr. request ændrer sig. Brugeren kan ikke skifte midt
 * i et render-pass, og de to steder der tildeler roller (provisionOwner/provisionPartner)
 * afslutter med en redirect frem for at læse brugeren igen i samme request.
 */
const resolveCurrentUser = cache(
  (env: Record<string, string | undefined>): Promise<AuthUser | null> =>
    createSessionProvider(env).getCurrentUser(),
);

/**
 * Bekvem adgang til den nuværende bruger i server-komponenter/-actions uden global
 * bootstrap: vælger provider ud fra env og henter brugeren. Returnerer null hvis
 * ikke logget ind (eller auth ikke konfigureret → stub).
 */
export function getCurrentUser(
  env: Record<string, string | undefined> = process.env,
): Promise<AuthUser | null> {
  return resolveCurrentUser(env);
}
