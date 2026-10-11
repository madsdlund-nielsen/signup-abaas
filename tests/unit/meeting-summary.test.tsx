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

  it("viser en rolig 'på vej'-linje mens resuméet endnu ikke er genereret", () => {
    const { container } = render(<MeetingSummary state={{ kind: "pending" }} />);
    expect(container.querySelector("p.empty")?.textContent).toContain("på vej");
    expect(container.querySelector(".summary-actions")).toBeNull();
  });

  it("forklarer manglende samtykke og manglende optagelse hver for sig", () => {
    const consent = render(<MeetingSummary state={{ kind: "missing_consent" }} />);
    expect(consent.container.querySelector("p.empty")?.textContent).toContain("samtykke");
    consent.unmount();

    const recording = render(<MeetingSummary state={{ kind: "missing_recording" }} />);
    expect(recording.container.querySelector("p.empty")?.textContent).toContain("optagelse");
  });

  it("viser 'Generér igen'-slotten kun ved en opgivet opsummering", () => {
    const retry = <button type="submit">Generér igen</button>;
    const failed = render(<MeetingSummary state={{ kind: "failed" }} retry={retry} />);
    expect(failed.getByText("Generér igen")).toBeTruthy();
    failed.unmount();

    const pending = render(<MeetingSummary state={{ kind: "pending" }} retry={retry} />);
    expect(pending.queryByText("Generér igen")).toBeNull();
  });
});
