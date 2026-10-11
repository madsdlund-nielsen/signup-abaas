import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

import { BrowserAnalytics } from "@/lib/analytics/BrowserAnalytics";
import { CONSENT_CHANGED_EVENT, type ConsentState } from "@/server/consent";

// Adapteren er mocket: her testes kun bindingen mellem samtykke og SDK-kald (ADR 0072).
const start = vi.fn(async (_apiKey: string) => true);
const stop = vi.fn();
const pageview = vi.fn(async (_path: string) => undefined);
vi.mock("@/lib/analytics/browser", () => ({
  startBrowserAnalytics: (key: string) => start(key),
  stopBrowserAnalytics: () => stop(),
  captureBrowserPageview: (path: string) => pageview(path),
}));

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const JA: ConsentState = { necessary: true, functional: false, analytics: true };
const NEJ: ConsentState = { necessary: true, functional: false, analytics: false };

function announce(state: ConsentState) {
  act(() => {
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: state }));
  });
}

beforeEach(() => {
  start.mockClear();
  stop.mockClear();
  pageview.mockClear();
  pathname = "/";
});

describe("BrowserAnalytics — samtykke styrer SDK'et", () => {
  it("ingen UI", () => {
    const { container } = render(<BrowserAnalytics apiKey="phc_x" initial={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("ikke valgt: SDK'et startes ikke og sender intet — det rydder kun rester", () => {
    render(<BrowserAnalytics apiKey="phc_x" initial={null} />);
    expect(start).not.toHaveBeenCalled();
    expect(pageview).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it("kun nødvendige: samme som ikke valgt", () => {
    render(<BrowserAnalytics apiKey="phc_x" initial={NEJ} />);
    expect(start).not.toHaveBeenCalled();
    expect(pageview).not.toHaveBeenCalled();
  });

  it("analyse tilladt ved indlæsning: start og én sidevisning", async () => {
    pathname = "/board";
    render(<BrowserAnalytics apiKey="phc_x" initial={JA} />);
    await vi.waitFor(() => expect(pageview).toHaveBeenCalledWith("/board"));
    expect(start).toHaveBeenCalledWith("phc_x");
    expect(stop).not.toHaveBeenCalled();
  });

  it("«Tillad analyse» i banneret starter SDK'et og sender sidevisningen", async () => {
    render(<BrowserAnalytics apiKey="phc_x" initial={null} />);
    announce(JA);
    await vi.waitFor(() => expect(pageview).toHaveBeenCalledWith("/"));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("tilbagekaldelse stopper og rydder", () => {
    render(<BrowserAnalytics apiKey="phc_x" initial={JA} />);
    stop.mockClear();
    announce(NEJ);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("sidenavigation giver en ny sidevisning — men kun mens samtykket gælder", async () => {
    const { rerender } = render(<BrowserAnalytics apiKey="phc_x" initial={JA} />);
    await vi.waitFor(() => expect(pageview).toHaveBeenCalledTimes(1));
    pathname = "/moeder";
    rerender(<BrowserAnalytics apiKey="phc_x" initial={JA} />);
    await vi.waitFor(() => expect(pageview).toHaveBeenLastCalledWith("/moeder"));

    announce(NEJ);
    pageview.mockClear();
    pathname = "/betaling";
    rerender(<BrowserAnalytics apiKey="phc_x" initial={JA} />);
    expect(pageview).not.toHaveBeenCalled();
  });

  it("sender ikke en sidevisning hvis SDK'et ikke blev startet (samtykke trukket under hentning)", async () => {
    start.mockResolvedValueOnce(false);
    render(<BrowserAnalytics apiKey="phc_x" initial={JA} />);
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    await Promise.resolve();
    expect(pageview).not.toHaveBeenCalled();
  });
});
