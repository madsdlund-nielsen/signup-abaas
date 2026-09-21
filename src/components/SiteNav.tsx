import Link from "next/link";

import { getCurrentUser, type AuthUser } from "@/server/auth";

/**
 * Header-nav'ens auth-afhængige led — ren præsentation, så rolle-logikken kan testes
 * uden at mocke auth-laget (tests/CLAUDE.md: DI af afhængigheder, ikke mocks).
 */
export function SiteNavLinks({ user }: { user: AuthUser | null }) {
  if (!user) {
    return (
      <>
        <Link href="/login">Log ind</Link>
        <Link className="btn-primary btn-primary--compact" href="/signup">
          Kom i gang
        </Link>
      </>
    );
  }

  return (
    <>
      <Link href="/dashboard">Dashboard</Link>
      {user.roles.includes("ejer") ? <Link href="/moeder">Møder</Link> : null}
      {user.roles.includes("partner") ? <Link href="/partner">Partner</Link> : null}
      {user.roles.includes("admin") ? <Link href="/admin">Admin</Link> : null}
    </>
  );
}

/**
 * Den eneste del af kromet der skal vide hvem der kigger (ADR 0050).
 *
 * Så længe brugeropslaget lå i rodlayoutet, gjorde det HVER rute dynamisk — også
 * forsiden, /login og /signup, som ellers prærenderes. Værre: hele siden ventede på
 * en rundtur til Supabase før første byte. Her er afhængigheden isoleret, så
 * SiteHeader kan sende kromet af sted med det samme og denne ene bid streame ind bagefter.
 */
export async function SiteNav() {
  const user = await getCurrentUser();
  return <SiteNavLinks user={user} />;
}
