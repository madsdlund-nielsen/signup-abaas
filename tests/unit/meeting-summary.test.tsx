import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { MeetingSummary } from "@/components/MeetingSummary";

/** Opsummeringsskærmen (fase 4.4, skærm-først): token-klasser, ingen inline-styles. */
describe("MeetingSummary", () => {
  it("viser kilde, referat og handlingspunkter — kun token-klasser", () => {
    const { container, getByText } = render(
      <MeetingSummary
        state={{
          kind: "ready",
          source: "demo",
          summary: "[DEMO] Resumé",
          actionItems: ["[DEMO] Første punkt", "[DEMO] Andet punkt"],
        }}
      />,
    );
    expect(getByText("[DEMO] Resumé").className).toBe("body");
    expect(getByText("Demo-opsummering")).toBeTruthy();
    expect(container.querySelectorAll("ol.summary-actions li")).toHaveLength(2);
    const styled = [...container.querySelectorAll("*")].filter((el) => el.getAttribute("style"));
    expect(styled).toHaveLength(0);
  });

  it("mærker en rigtig opsummering som genereret — ikke demo", () => {
    const { getByText, queryByText } = render(
      <MeetingSummary state={{ kind: "ready", source: "live", summary: "Resumé", actionItems: [] }} />,
    );
    expect(getByText(/Genereret af Ordbogen/)).toBeTruthy();
    expect(queryByText("Handlingspunkter")).toBeNull();
  });

  it("viser et synligt hul når AI-opfølgning ikke er konfigureret", () => {
    const { container } = render(
      <MeetingSummary
        state={{ kind: "unavailable", reason: "AI-opfølgning er ikke konfigureret endnu." }}
      />,
    );
    expect(container.querySelector("p.empty")?.textContent).toContain("ikke konfigureret");
    expect(container.querySelector(".summary-actions")).toBeNull();
  });
});
