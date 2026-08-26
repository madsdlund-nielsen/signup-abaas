import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Heading } from "@/components/Heading";
import { SectionBand } from "@/components/SectionBand";
import { Eyebrow } from "@/components/Eyebrow";
import { Card } from "@/components/Card";
import { Container } from "@/components/Container";
import { TopBar } from "@/components/TopBar";

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

  it("Container renderer .container-x uden inline-style", () => {
    const { container } = render(<Container>indhold</Container>);
    const div = container.querySelector("div");
    expect(div?.className).toBe("container-x");
    expect(div?.textContent).toBe("indhold");
    expect(div?.getAttribute("style")).toBeNull();
  });

  it("TopBar wrapper indhold i .topbar > .topbar__inner uden inline-style", () => {
    const { container } = render(<TopBar>kontakt</TopBar>);
    const outer = container.querySelector("div.topbar");
    const inner = container.querySelector("div.topbar__inner");
    expect(outer).not.toBeNull();
    expect(inner?.textContent).toBe("kontakt");
    expect(outer?.getAttribute("style")).toBeNull();
    expect(inner?.getAttribute("style")).toBeNull();
  });
});
