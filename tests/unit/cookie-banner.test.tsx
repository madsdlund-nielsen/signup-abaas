import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { CookieBanner } from "@/components/CookieBanner";
import { CookieSettingsLink } from "@/components/CookieSettingsLink";
import { SiteFooter } from "@/components/SiteFooter";
import {
  CONSENT_CHANGED_EVENT,
  CONSENT_COOKIE,
  readConsentChoice,
  type ConsentState,
} from "@/server/consent";

/**
 * Cookie-banneret (ADR 0072): tilstande, valg, genåbning fra footeren, tastatur og at de to
 * valg er ligeværdige. Banneret renderes kun af rodlayoutet når browser-analytics er slået til
 * (se `tests/unit/browser-analytics.test.ts` for den betingelse).
 */

const NEJ: ConsentState = { necessary: true, functional: false, analytics: false };
const JA: ConsentState = { necessary: true, functional: false, analytics: true };

function savedCookie(): ConsentState | null {
  const part = document.cookie.split("; ").find((c) => c.startsWith(`${CONSENT_COOKIE}=`));
  return readConsentChoice(part?.slice(CONSENT_COOKIE.length + 1));
}

function listen() {
  const events: ConsentState[] = [];
  const handler = (e: Event) => events.push((e as CustomEvent<ConsentState>).detail);
  window.addEventListener(CONSENT_CHANGED_EVENT, handler);
  return { events, stop: () => window.removeEventListener(CONSENT_CHANGED_EVENT, handler) };
}

beforeEach(() => {
  document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
});
afterEach(() => {
  document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
});

describe("CookieBanner — første besøg (intet valg)", () => {
  it("vises som en navngiven region og er ikke en modal", () => {
    render(<CookieBanner initial={null} />);
    const region = screen.getByRole("region", { name: "Cookies" });
    expect(region).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(region.getAttribute("aria-modal")).toBeNull();
  });

  it("beskriver neutralt hvad cookies bruges til, uden at love noget juridisk", () => {
    render(<CookieBanner initial={null} />);
    const text = screen.getByRole("region").textContent ?? "";
    expect(text).toContain("login");
    expect(text).toContain("PostHog (EU)");
    expect(text).not.toMatch(/garant|lover|100 ?%|GDPR-compliant/i);
  });

  it("«Kun nødvendige» og «Tillad analyse» er samme knaptype — ingen er fremhævet", () => {
    render(<CookieBanner initial={null} />);
    const nej = screen.getByRole("button", { name: "Kun nødvendige" });
    const ja = screen.getByRole("button", { name: "Tillad analyse" });
    expect(nej.className).toBe(ja.className);
    expect(nej.className).not.toContain("primary");
    expect(nej.hasAttribute("autofocus")).toBe(false);
    expect(ja.hasAttribute("autofocus")).toBe(false);
  });

  it("stjæler ikke fokus ved første indlæsning", () => {
    render(<CookieBanner initial={null} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("bruger token-klasser og ingen inline-styles", () => {
    const { container } = render(<CookieBanner initial={null} />);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("«Kun nødvendige» gemmer valget i cookien, melder det og lukker banneret", () => {
    const { events, stop } = listen();
    render(<CookieBanner initial={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Kun nødvendige" }));
    expect(savedCookie()).toEqual(NEJ);
    expect(events).toEqual([NEJ]);
    expect(screen.queryByRole("region", { name: "Cookies" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("kun nødvendige");
    stop();
  });

  it("«Tillad analyse» gemmer analytics = true og melder det", () => {
    const { events, stop } = listen();
    render(<CookieBanner initial={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Tillad analyse" }));
    expect(savedCookie()).toEqual(JA);
    expect(events).toEqual([JA]);
    expect(screen.getByRole("status").textContent).toContain("analyse er tilladt");
    stop();
  });

  it("intet gemmes og intet meldes før der vælges", () => {
    const { events, stop } = listen();
    render(<CookieBanner initial={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Indstillinger" }));
    expect(savedCookie()).toBeNull();
    expect(events).toEqual([]);
    stop();
  });

  it("ESC gør ikke noget ved første besøg: et valg skal træffes, ikke fjernes", () => {
    render(<CookieBanner initial={null} />);
    fireEvent.keyDown(screen.getByRole("region"), { key: "Escape" });
    expect(screen.getByRole("region", { name: "Cookies" })).toBeTruthy();
    expect(savedCookie()).toBeNull();
  });
});

describe("CookieBanner — indstillinger", () => {
  it("viser kategorierne: nødvendige (fast til, kan ikke fravælges) og analyse (fra som standard)", () => {
    render(<CookieBanner initial={null} />);
    const toggle = screen.getByRole("button", { name: "Indstillinger" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    const necessary = screen.getByRole("checkbox", { name: "Nødvendige" }) as HTMLInputElement;
    const analytics = screen.getByRole("checkbox", { name: "Analyse" }) as HTMLInputElement;
    expect(necessary.checked).toBe(true);
    expect(necessary.disabled).toBe(true);
    expect(analytics.checked).toBe(false); // opt-in: aldrig forhåndsafkrydset
    expect(analytics.disabled).toBe(false);
    expect(screen.getByRole("group", { name: "Vælg kategorier" })).toBeTruthy();
    expect(analytics.getAttribute("aria-describedby")).toBe("cookie-analytics-desc");
    expect(document.getElementById("cookie-analytics-desc")?.textContent).toContain("PostHog");
  });

  it("«Gem valg» gemmer det afkrydsede", () => {
    render(<CookieBanner initial={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Indstillinger" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Analyse" }));
    fireEvent.click(screen.getByRole("button", { name: "Gem valg" }));
    expect(savedCookie()).toEqual(JA);
  });

  it("ESC lukker indstillingerne (ikke banneret) og flytter fokus til knappen", () => {
    render(<CookieBanner initial={null} />);
    const toggle = screen.getByRole("button", { name: "Indstillinger" });
    fireEvent.click(toggle);
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Analyse" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Vælg kategorier" })).toBeNull();
    expect(screen.getByRole("region", { name: "Cookies" })).toBeTruthy();
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("CookieBanner — der ligger allerede et valg", () => {
  it("vises ikke", () => {
    render(<CookieBanner initial={NEJ} />);
    expect(screen.queryByRole("region", { name: "Cookies" })).toBeNull();
  });

  it("genåbnes fra footerens «Cookie-indstillinger» med indstillingerne fremme og det gemte valg", () => {
    render(
      <>
        <CookieBanner initial={JA} />
        <CookieSettingsLink />
      </>,
    );
    const link = screen.getByRole("button", { name: "Cookie-indstillinger" });
    link.focus();
    fireEvent.click(link);
    expect(screen.getByRole("region", { name: "Cookies" })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Analyse" }) as HTMLInputElement).checked).toBe(true);
    expect(document.activeElement?.id).toBe("cookiebanner-title");
  });

  it("kan trække samtykket tilbage, og fokus går tilbage til footerlinket", () => {
    const { events, stop } = listen();
    render(
      <>
        <CookieBanner initial={JA} />
        <CookieSettingsLink />
      </>,
    );
    const link = screen.getByRole("button", { name: "Cookie-indstillinger" });
    link.focus();
    fireEvent.click(link);
    fireEvent.click(screen.getByRole("checkbox", { name: "Analyse" }));
    fireEvent.click(screen.getByRole("button", { name: "Gem valg" }));
    expect(savedCookie()).toEqual(NEJ);
    expect(events).toEqual([NEJ]);
    expect(screen.queryByRole("region", { name: "Cookies" })).toBeNull();
    expect(document.activeElement).toBe(link);
    stop();
  });

  it("ESC (to gange) lukker en genåbnet banner uden at ændre valget", () => {
    const { events, stop } = listen();
    render(
      <>
        <CookieBanner initial={JA} />
        <CookieSettingsLink />
      </>,
    );
    act(() => {
      screen.getByRole("button", { name: "Cookie-indstillinger" }).focus();
    });
    fireEvent.click(screen.getByRole("button", { name: "Cookie-indstillinger" }));
    fireEvent.keyDown(screen.getByRole("region"), { key: "Escape" }); // lukker indstillinger
    fireEvent.keyDown(screen.getByRole("region"), { key: "Escape" }); // lukker banneret
    expect(screen.queryByRole("region", { name: "Cookies" })).toBeNull();
    expect(events).toEqual([]);
    expect(savedCookie()).toBeNull(); // intet nyt skrevet
    stop();
  });
});

describe("SiteFooter — Cookie-indstillinger", () => {
  it("vises kun når banneret findes (cookieSettings)", () => {
    const { rerender } = render(<SiteFooter />);
    expect(screen.queryByRole("button", { name: "Cookie-indstillinger" })).toBeNull();
    rerender(<SiteFooter cookieSettings />);
    expect(screen.getByRole("button", { name: "Cookie-indstillinger" })).toBeTruthy();
  });
});

describe("CookieBanner — cookies blokeret", () => {
  it("valget gælder stadig i sessionen, selv om cookien ikke kan skrives", () => {
    const spy = vi.spyOn(document, "cookie", "set").mockImplementation(() => {
      throw new Error("blokeret");
    });
    const { events, stop } = listen();
    render(<CookieBanner initial={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Tillad analyse" }));
    expect(events).toEqual([JA]);
    spy.mockRestore();
    stop();
  });
});
