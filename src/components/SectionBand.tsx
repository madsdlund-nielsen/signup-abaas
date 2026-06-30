import type { ReactNode } from "react";

export type BandTone = "white" | "grey" | "navy";

/**
 * Fuldbredde sektionsbånd med skiftende baggrund (hvid → grå → navy) og
 * lodret luft mellem sektioner. Indhold centreres i container-bredde.
 */
export function SectionBand({
  tone = "white",
  children,
}: {
  tone?: BandTone;
  children: ReactNode;
}) {
  return (
    <section className={`band band--${tone}`}>
      <div className="band__inner">{children}</div>
    </section>
  );
}
