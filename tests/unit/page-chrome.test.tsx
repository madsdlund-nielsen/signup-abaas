import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { PageBody, PageHeader } from "@/components/PageHeader";

/**
 * Sidehovedet på de signerede flader (ADR 0039). Ud over token-reglen fra tests/CLAUDE.md
 * vogter testene her de to valg der bærer designmanualens rytme, og som ingen opdager er
 * væk før ejeren ser siden: at båndet er navy (ikke charcoal, som site-headeren ovenfor),
 * og at teksten på båndet bruger on-dark-varianterne.
 */
describe("PageHeader", () => {
  const base = { eyebrow: "Board", title: "Dit advisory board" };

  it("renderer båndet med token-klasser og uden inline-style", () => {
    const { container } = render(<PageHeader {...base} />);
    const section = container.querySelector("section");
    expect(section?.className).toBe("pagehead");
    expect(section?.getAttribute("style")).toBeNull();
    expect(container.querySelector(".pagehead__inner")).not.toBeNull();
  });

  it("sætter overskriften i on-dark-varianten — båndet er mørkt", () => {
    const { getByRole } = render(<PageHeader {...base} />);
    const h1 = getByRole("heading", { level: 1, name: base.title });
    expect(h1.className).toBe("heading-2 heading--on-dark");
  });

  it("brødkrummen bruger .eyebrow, så versal-UI kommer fra tokens", () => {
    const { container } = render(<PageHeader {...base} />);
    expect(container.querySelector("p.eyebrow")?.textContent).toBe("Board");
  });

  it("udelader underrubrik og handlinger når de ikke er sat", () => {
    const { container } = render(<PageHeader {...base} />);
    expect(container.querySelector(".lead")).toBeNull();
    expect(container.querySelector(".pagehead__actions")).toBeNull();
  });

  it("renderer underrubrik og handlinger når de er sat", () => {
    const { container, getByRole } = render(
      <PageHeader {...base} lead="Tre rådgivere" actions={<button>Book</button>} />,
    );
    expect(container.querySelector("p.lead")?.className).toBe("lead lead--on-dark measure");
    expect(container.querySelector(".pagehead__actions")?.className).toBe(
      "row-form pagehead__actions",
    );
    expect(getByRole("button", { name: "Book" })).not.toBeNull();
  });
});

describe("PageBody", () => {
  it("bærer den lodrette luft via .pagebody + .stack uden inline-style", () => {
    const { container } = render(<PageBody>indhold</PageBody>);
    const main = container.querySelector("main");
    expect(main?.className).toBe("pagebody");
    expect(main?.getAttribute("style")).toBeNull();
    const inner = container.querySelector(".pagebody__inner");
    expect(inner?.className).toBe("pagebody__inner stack");
    expect(inner?.textContent).toBe("indhold");
  });
});
