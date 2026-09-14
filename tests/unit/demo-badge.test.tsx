import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { DemoBadge } from "@/components/DemoBadge";

/** Demo-mærket (ADR 0041): token-klasse, ingen inline-style, og det siger hvad det er. */
describe("DemoBadge", () => {
  it("bruger token-klassen og ingen inline-style", () => {
    const { container } = render(<DemoBadge />);
    const span = container.querySelector("span");
    expect(span?.className).toBe("siteheader__demo");
    expect(span?.getAttribute("style")).toBeNull();
  });

  it("siger Demo — og forklarer i title hvad det betyder", () => {
    const { getByText } = render(<DemoBadge />);
    expect(getByText("Demo").getAttribute("title")).toMatch(/demo-implementeringer/i);
  });
});
