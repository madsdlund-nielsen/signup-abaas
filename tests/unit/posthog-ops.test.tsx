import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { PostHogOpsSection } from "@/components/PostHogOps";
import type { PostHogOps } from "@/server/admin";

const ok: PostHogOps = {
  state: "ok",
  source: "real",
  generatedAt: "2026-10-11T12:00:00.000Z",
  metrics: {
    events: 1234,
    exceptions: 0,
    topExceptionTypes: [{ type: "TypeError", count: 5 }],
    activePeople: 42,
  },
};

describe("PostHogOpsSection", () => {
  it("viser tallene tal-først i .stats", () => {
    const { container, getByText } = render(<PostHogOpsSection posthog={ok} />);
    expect(getByText("Drift (PostHog)")).toBeTruthy();
    expect(container.querySelectorAll(".stats .stat")).toHaveLength(3);
    expect(container.textContent).toContain("1234");
    expect(container.textContent).toContain("42");
    expect(getByText("TypeError")).toBeTruthy();
    expect(container.textContent).not.toContain("[DEMO]");
  });

  it("nul undtagelser er et ægte nul med en tydelig tom-tilstand", () => {
    const { getByText } = render(<PostHogOpsSection posthog={ok} />);
    expect(getByText("0")).toBeTruthy();
    const none: PostHogOps = { ...ok, metrics: { ...ok.metrics, topExceptionTypes: [] } } as PostHogOps;
    const { getByText: g2 } = render(<PostHogOpsSection posthog={none} />);
    expect(g2("Ingen undtagelser registreret i perioden.")).toBeTruthy();
  });

  it("demo er mærket [DEMO] og siger at intet er målt", () => {
    const { getByRole } = render(<PostHogOpsSection posthog={{ ...ok, source: "demo" } as PostHogOps} />);
    expect(getByRole("status").textContent).toMatch(/^\[DEMO\].*Intet herunder er målt/);
  });

  it("ikke koblet på: forklarer hvad der mangler — ingen tal", () => {
    const { container } = render(<PostHogOpsSection posthog={{ state: "not_configured" }} />);
    expect(container.textContent).toMatch(/Ikke koblet på — mangler PostHog-læsenøgle/);
    expect(container.querySelector(".stat")).toBeNull();
    expect(container.textContent).not.toMatch(/\b0\b/);
  });

  it("kunne ikke læses: siger det, uden tal", () => {
    const { container } = render(<PostHogOpsSection posthog={{ state: "unreadable" }} />);
    expect(container.textContent).toMatch(/Kunne ikke læses/);
    expect(container.querySelector(".stat")).toBeNull();
  });

  it.each([ok, { ...ok, source: "demo" }, { state: "not_configured" }, { state: "unreadable" }] as PostHogOps[])(
    "bruger kun token-klasser — ingen inline-styles (%#)",
    (posthog) => {
      const { container } = render(<PostHogOpsSection posthog={posthog} />);
      expect([...container.querySelectorAll("*")].filter((el) => el.getAttribute("style"))).toHaveLength(0);
    },
  );
});
