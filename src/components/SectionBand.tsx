import type { ReactNode } from "react";

export type BandTone = "white" | "grey" | "navy" | "charcoal";

/**
 * Fuldbredde sektionsbånd med skiftende baggrund og ~90 px lodret luft mellem sektioner
 * (designmanual v1.2, side 11: "rytmen er vekslende bånd ... skiftet bærer siden").
 * Indhold centreres i container-bredde.
 *
 * `charcoal` er manualens hero- og fotobaggrundsflade; `navy` er sektionsbånd og paneler.
 * De to er ikke ombyttelige — charcoal bærer sidens tungeste flade, navy dens rytme.
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
