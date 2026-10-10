import type { ReactNode } from "react";

export type StatusBadgeTone = "live" | "draft" | "none" | "archived";

/**
 * Versalt statusmærke (fase 4.6). Bærer det eksplicitte krav om at admin aldrig skal være i
 * tvivl om hvad der er i produktion: LIVE er guldfyldt (den eneste sparsomme accent på fladen),
 * UDKAST er en navy kontur, og «ingen live» er dæmpet. Mærket gentager altid sin tilstand som
 * TEKST — farven er forstærkning, ikke den eneste bærer. Al styling via token-klasser.
 */
export function StatusBadge({ tone, children }: { tone: StatusBadgeTone; children: ReactNode }) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}
