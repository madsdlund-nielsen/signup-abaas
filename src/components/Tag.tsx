import type { ReactNode } from "react";

/**
 * Kompetence-tag/chip. Firkantet, versal, guld-kant. Kun tokens — ingen
 * hardcodede farver/fonts/radius/spacing. (Admin styrer hvilke tags der findes;
 * denne komponent er ren præsentation.)
 */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}
