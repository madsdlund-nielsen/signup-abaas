import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { SectionBand } from "@/components/SectionBand";
import { SiteFooter } from "@/components/SiteFooter";

/**
 * Site-chrome (ADR 0039). Ud over token-reglen fra tests/CLAUDE.md tester vi her det der
 * faktisk kan gå galt uden at nogen opdager det: at mærkerne bruges i den skala
 * designmanualen binder dem til. Et mærke sat under sin grænse renderer gråt frem for at
 * fejle, så en test er den eneste vagt.
 *
 * SiteHeader er en async server-komponent der læser session og kan derfor ikke renderes
 * med RTL uden at mocke auth-laget. Dens mærkevalg dækkes af CSS-reglerne, ikke her.
 */
describe("SectionBand — charcoal-tonen (designmanual v1.2)", () => {
  it("charcoal er en selvstændig tone, ikke navy", () => {
    const { container } = render(<SectionBand tone="charcoal">x</SectionBand>);
    const section = container.querySelector("section");
    expect(section?.className).toBe("band band--charcoal");
    expect(section?.getAttribute("style")).toBeNull();
  });

  it("default-tonen er hvid", () => {
    const { container } = render(<SectionBand>x</SectionBand>);
    expect(container.querySelector("section")?.className).toBe("band band--white");
  });
});

describe("SiteFooter", () => {
  it("bruger kortform 05 i den lyse variant til mørk flade", () => {
    const { container } = render(<SiteFooter />);
    const img = container.querySelector("img");
    // -light-on-dark dækker både charcoal og navy; navy-varianten hører til lyse flader.
    expect(img?.getAttribute("src")).toContain("abu-mark-05-light-on-dark");
  });

  it("sætter mærket på mindst 320 px — kortform 05's nedre grænse", () => {
    const { container } = render(<SiteFooter />);
    const img = container.querySelector("img");
    expect(Number(img?.getAttribute("width"))).toBeGreaterThanOrEqual(320);
  });

  it("bruger token-klasser og ingen inline-styles på egne elementer", () => {
    const { container } = render(<SiteFooter />);
    const footer = container.querySelector("footer");
    expect(footer?.className).toBe("sitefooter");
    // next/image sætter selv style på <img>; alt andet skal være rent.
    const styled = [...container.querySelectorAll("*")].filter(
      (el) => el.tagName !== "IMG" && el.getAttribute("style"),
    );
    expect(styled).toHaveLength(0);
  });

  it("navngiver afsenderen i kolofonen", () => {
    const { getByText } = render(<SiteFooter />);
    expect(getByText(/CVR DK-38913557/)).toBeTruthy();
  });
});
