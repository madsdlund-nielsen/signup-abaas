import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Heading } from "@/components/Heading";
import { SectionBand } from "@/components/SectionBand";
import { Eyebrow } from "@/components/Eyebrow";
import { Card } from "@/components/Card";
import { Tag } from "@/components/Tag";

describe("design-komponenter (kun tokens via klasser)", () => {
  it("Heading bruger korrekt niveau-tag + token-klasse uden inline-style", () => {
    const { getByRole } = render(<Heading level={1}>Titel</Heading>);
    const h1 = getByRole("heading", { level: 1, name: "Titel" });
    expect(h1.className).toBe("heading-1 heading--on-light");
    expect(h1.getAttribute("style")).toBeNull();
  });

  it("Heading onDark skifter til on-dark-klassen", () => {
    const { getByRole } = render(
      <Heading level={2} onDark>
        Mørk
      </Heading>,
    );
    expect(getByRole("heading", { level: 2 }).className).toContain("heading--on-dark");
  });

  it("SectionBand vælger tone-variant uden inline-style", () => {
    const { container } = render(<SectionBand tone="navy">x</SectionBand>);
    const section = container.querySelector("section");
    expect(section?.className).toBe("band band--navy");
    expect(section?.getAttribute("style")).toBeNull();
  });

  it("Eyebrow renderer .eyebrow uden inline-style", () => {
    const { container } = render(<Eyebrow>Label</Eyebrow>);
    const p = container.querySelector("p");
    expect(p?.className).toBe("eyebrow");
    expect(p?.getAttribute("style")).toBeNull();
  });

  it("Card har versal titel-klasse og sætter ingen inline-style uden billede", () => {
    const { getByRole, container } = render(<Card title="Strategi" />);
    expect(getByRole("heading", { level: 3, name: "Strategi" }).className).toBe("card__title");
    expect(container.querySelector(".card__media")?.getAttribute("style")).toBeNull();
  });

  it("Tag renderer .tag uden inline-style (kun tokens)", () => {
    const { container } = render(<Tag>Strategi</Tag>);
    const span = container.querySelector("span");
    expect(span?.className).toBe("tag");
    expect(span?.textContent).toBe("Strategi");
    expect(span?.getAttribute("style")).toBeNull();
  });
});
