/**
 * Provider-agnostisk auth-abstraktion (fase 0).
 *
 * Auth-LEVERANDØREN (Supabase Auth vs. eget system) er en åben 🟡 SPIKE — se
 * docs/fase-0-eksekvering.md, Trin 4. Denne port lader features og domænekode
 * tale om "den nuværende bruger" og roller uden at binde sig til leverandøren.
 * RLS hænger på rolle-relationen i databasen, ikke på auth-leverandøren, så
 * RLS-fundamentet (Trin 5) kan bygges uafhængigt af dette valg.
 *
 * TODO(mads): auth-valg (spike) — implementér en rigtig SessionProvider oven på
 * den valgte leverandør og registrér den via setSessionProvider().
 */

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
