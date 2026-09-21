import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { SiteHeader } from "@/components/SiteHeader";
import { SiteNav, SiteNavLinks } from "@/components/SiteNav";
import type { AuthUser } from "@/server/auth";

function user(roles: AuthUser["roles"]): AuthUser {
  return { id: "u1", email: "u1@example.dk", roles };
}

function hrefs(container: HTMLElement): string[] {
  return [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
}

/**
 * Header-kromet efter opdelingen (ADR 0050). Rolle-logikken i nav'en var utestet så længe
 * SiteHeader var en async server-komponent der læste sessionen — nu er den ren, og kan
 * dækkes uden at mocke auth-laget.
 */
describe("SiteNavLinks — rolle-afhængige indgange", () => {
  it("udlogget: log ind + CTA, og ingen app-indgange", () => {
    const { container } = render(<SiteNavLinks user={null} />);
    expect(hrefs(container)).toEqual(["/login", "/signup"]);
  });

  it("ejer ser møder, men hverken partner- eller admin-indgangen", () => {
    const { container } = render(<SiteNavLinks user={user(["ejer"])} />);
    expect(hrefs(container)).toEqual(["/dashboard", "/moeder"]);
  });

  it("partner ser partner-indgangen, ikke møder eller admin", () => {
    const { container } = render(<SiteNavLinks user={user(["partner"])} />);
    expect(hrefs(container)).toEqual(["/dashboard", "/partner"]);
  });

  it("admin ser admin-indgangen", () => {
    const { container } = render(<SiteNavLinks user={user(["admin"])} />);
    expect(hrefs(container)).toEqual(["/dashboard", "/admin"]);
  });

  it("flere roller giver flere indgange, i fast rækkefølge", () => {
    const { container } = render(<SiteNavLinks user={user(["ejer", "partner", "admin"])} />);
    expect(hrefs(container)).toEqual(["/dashboard", "/moeder", "/partner", "/admin"]);
  });

  it("en bruger uden roller får kun dashboard — aldrig en indgang den ikke må se", () => {
    const { container } = render(<SiteNavLinks user={user([])} />);
    expect(hrefs(container)).toEqual(["/dashboard"]);
  });
});

describe("SiteNav — uden konfigureret auth", () => {
  it("falder tilbage til den udloggede nav frem for at fejle", async () => {
    // Async server-komponent: kald den og render resultatet. Uden Supabase-konfiguration
    // giver auth-porten stub'en, altså ingen bruger — kontofri CI skal stadig kunne rendere.
    const { container } = render(await SiteNav());
    expect(hrefs(container)).toEqual(["/login", "/signup"]);
  });
});

describe("SiteHeader — kromet må ikke afhænge af sessionen (ADR 0050)", () => {
  it("er synkron, så rodlayoutet ikke trækker hver rute ind i dynamisk rendering", () => {
    // En async komponent ville returnere et Promise. Det er præcis den egenskab der gjorde
    // hver rute dynamisk, så den er værd at holde fast på.
    expect(SiteHeader.constructor.name).not.toBe("AsyncFunction");
  });

  it("renderer mærke og nav-stel uden auth — og kun med token-klasser", () => {
    const { container } = render(<SiteHeader />);
    expect(container.querySelector("header.siteheader")).toBeTruthy();
    expect(container.querySelector("nav.siteheader__nav")).toBeTruthy();
    // Både løsen og kortformen ligger i DOM'en; CSS vælger (designmanual v1.2).
    expect(container.querySelectorAll("img")).toHaveLength(2);
    // next/image sætter selv en inline-style på sine <img>. Reglen gælder det VI skriver,
    // så billederne holdes uden for — resten skal komme fra token-klasser.
    const styled = [...container.querySelectorAll("*")]
      .filter((el) => el.tagName !== "IMG")
      .filter((el) => el.getAttribute("style"));
    expect(styled).toHaveLength(0);
  });
});
