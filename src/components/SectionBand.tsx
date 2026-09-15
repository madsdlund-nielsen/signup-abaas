import type { ReactNode } from "react";

export type BandTone = "white" | "grey" | "navy" | "charcoal";

/**
 * Fuldbredde sektionsbånd med skiftende baggrund og ~100 px lodret luft mellem sektioner
 * (designmanual v1.2, side 11: "rytmen er vekslende bånd ... skiftet bærer siden";
 * luften er sitets målte værdi, ADR 0044). Indhold centreres i container-bredde.
 *
 * `charcoal` er manualens hero- og fotobaggrundsflade; `navy` er sektionsbånd og paneler.
 * De to er ikke ombyttelige — charcoal bærer sidens tungeste flade, navy dens rytme.
 *
 * `hero` gør båndet til sidens hero: bredere række (1400 px) og mere luft (155 px) —
 * sitets hero-række er målt bredere end resten af indholdet.
 */
export function SectionBand({
  tone = "white",
  hero = false,
  children,
}: {
  tone?: BandTone;
  hero?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`band band--${tone}${hero ? " band--hero" : ""}`}>
      <div className="band__inner">{children}</div>
    </section>
  );
}
