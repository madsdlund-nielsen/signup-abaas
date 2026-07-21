/**
 * SessionProvider oven på Supabase Auth (ADR 0013). Selve SDK-kaldene ligger i
 * ./supabase-client bag en injicerbar gateway, så denne klasse kan enhedstestes
 * uden netværk, cookies eller SDK (jf. tests/CLAUDE.md — DI af afhængigheder, ikke mocks).
 */

import type { AuthUser, Role, SessionProvider } from "./index";

/** Den minimale Supabase-flade providereren har brug for. Implementeres i ./supabase-client. */
export interface SupabaseAuthGateway {
  /** JWT-verificeret bruger fra den nuværende session, eller null hvis ikke logget ind. */
  getAuthUser(): Promise<{ id: string; email: string | null } | null>;
  /** Brugerens roller fra user_role_assignment (server-side/service-role opslag). */
  getRoles(userId: string): Promise<Role[]>;
}

export class SupabaseSessionProvider implements SessionProvider {
  readonly name = "supabase";

  constructor(private readonly loadGateway: () => Promise<SupabaseAuthGateway>) {}

  async getCurrentUser(): Promise<AuthUser | null> {
    const gateway = await this.loadGateway();
    const authUser = await gateway.getAuthUser();
    if (!authUser) return null;
    const roles = await gateway.getRoles(authUser.id);
    return { id: authUser.id, email: authUser.email ?? "", roles };
  }
}
