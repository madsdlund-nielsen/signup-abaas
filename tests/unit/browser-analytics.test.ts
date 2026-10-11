import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  POSTHOG_BROWSER_HOST,
  readBrowserAnalyticsConfig,
  resolveConsentBoot,
} from "@/lib/analytics/browser-config";
import { sanitizeEvent, sanitizePath, sanitizeUrl } from "@/lib/analytics/browser-sanitize";
import { serializeConsent } from "@/server/consent";

/**
 * Browser-PostHog (ADR 0072): hvornår det overhovedet findes (config), hvad det må se (rensning
 * af adresser) og adapteren der kun initialiserer efter samtykke (SDK'et er mocket — intet
 * netværk). Den ægte adfærd i en browser er verificeret mod en produktionsbygning (ADR 0072).
 */

const ON = { FLAG_ANALYTICS: "true", NEXT_PUBLIC_POSTHOG_KEY: "phc_test" };

describe("readBrowserAnalyticsConfig — er der noget at spørge om?", () => {
  it("kræver BÅDE FLAG_ANALYTICS og en browser-nøgle", () => {
    expect(readBrowserAnalyticsConfig(ON)).toEqual({ apiKey: "phc_test" });
    expect(readBrowserAnalyticsConfig({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test" })).toBeNull();
    expect(readBrowserAnalyticsConfig({ FLAG_ANALYTICS: "true" })).toBeNull();
    expect(readBrowserAnalyticsConfig({ FLAG_ANALYTICS: "true", NEXT_PUBLIC_POSTHOG_KEY: "  " })).toBeNull();
    expect(readBrowserAnalyticsConfig({})).toBeNull();
  });

  it("serverens skrivenøgle POSTHOG_KEY er ikke browser-nøglen", () => {
    expect(readBrowserAnalyticsConfig({ FLAG_ANALYTICS: "true", POSTHOG_KEY: "phc_server" })).toBeNull();
  });

  it("værten er en EU-konstant, ikke en env var", () => {
    expect(POSTHOG_BROWSER_HOST).toBe("https://eu.i.posthog.com");
    expect(readBrowserAnalyticsConfig({ ...ON, NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com" })).toEqual({
      apiKey: "phc_test",
    });
  });
});

describe("resolveConsentBoot", () => {
  it("uden analytics-konfiguration: intet (intet banner, ingen cookie-læsning er nødvendig)", () => {
    expect(resolveConsentBoot({}, undefined)).toBeNull();
    expect(resolveConsentBoot({}, serializeConsent({ necessary: true, functional: false, analytics: true }))).toBeNull();
  });

  it("med konfiguration og uden cookie: ikke valgt (initial = null) → banneret spørger", () => {
    expect(resolveConsentBoot(ON, undefined)).toEqual({ apiKey: "phc_test", initial: null });
    expect(resolveConsentBoot(ON, "rod")?.initial).toBeNull();
  });

  it("med cookie: det gemte valg", () => {
    const valg = { necessary: true as const, functional: false, analytics: true };
    expect(resolveConsentBoot(ON, encodeURIComponent(serializeConsent(valg)))?.initial).toEqual(valg);
  });
});

describe("rensning af adresser", () => {
  it("fjerner forespørgsel og fragment", () => {
    expect(sanitizeUrl("https://abaas.example/login?code=hemmelig#x")).toBe("https://abaas.example/login");
    expect(sanitizeUrl("/auth/callback?code=abc")).toBe("/auth/callback");
  });

  it("skjuler rating-tokenet i stien (ADR 0060) og UUID'er", () => {
    expect(sanitizePath("/vurdering/abc.def-123")).toBe("/vurdering/[token]");
    expect(sanitizeUrl("https://x.example/vurdering/abc.def?x=1")).toBe("https://x.example/vurdering/[token]");
    expect(sanitizePath("/moeder/3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe("/moeder/[id]");
    expect(sanitizePath("/moeder")).toBe("/moeder");
    expect(sanitizePath("/")).toBe("/");
    expect(sanitizePath("/vurdering")).toBe("/vurdering");
  });

  it("ugyldig adresse giver tom streng i stedet for at kaste", () => {
    expect(sanitizeUrl("http://[")).toBe("");
  });

  it("sanitizeEvent renser properties, $set og $set_once — og lader resten være", () => {
    const event = {
      event: "$pageview",
      properties: {
        $current_url: "https://x.example/vurdering/hemmeligt?a=1",
        $pathname: "/vurdering/hemmeligt",
        $referrer: "https://google.com/search?q=privat",
        $initial_referrer: "$direct",
        $browser: "Chrome",
      },
      $set_once: { $initial_current_url: "https://x.example/login?code=1" },
    };
    const cleaned = sanitizeEvent(event)!;
    expect(cleaned.properties).toMatchObject({
      $current_url: "https://x.example/vurdering/[token]",
      $pathname: "/vurdering/[token]",
      $referrer: "https://google.com/search",
      $initial_referrer: "$direct",
      $browser: "Chrome",
    });
    expect(cleaned.$set_once.$initial_current_url).toBe("https://x.example/login");
    expect(JSON.stringify(cleaned)).not.toContain("hemmeligt");
    expect(event.properties.$current_url).toContain("?a=1"); // inputtet er uændret
    expect(sanitizeEvent(null)).toBeNull();
  });
});

describe("browser-adapteren — intet før samtykke", () => {
  const init = vi.fn<(key: string, config: Record<string, unknown>) => void>();
  const capture = vi.fn();
  const optOut = vi.fn();
  const optIn = vi.fn();
  const reset = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    for (const fn of [init, capture, optOut, optIn, reset]) fn.mockReset();
    vi.doMock("posthog-js", () => ({
      default: { init, capture, opt_out_capturing: optOut, opt_in_capturing: optIn, reset },
    }));
  });

  afterEach(() => {
    vi.doUnmock("posthog-js");
    document.cookie = "ph_phc_test_posthog=; Max-Age=0; Path=/";
    localStorage.clear();
    sessionStorage.clear();
  });

  it("at importere adapteren initialiserer ikke SDK'et", async () => {
    await import("@/lib/analytics/browser");
    expect(init).not.toHaveBeenCalled();
  });

  it("start initialiserer én gang, med EU-host og de privatlivsvenlige valg", async () => {
    const { startBrowserAnalytics } = await import("@/lib/analytics/browser");
    expect(await startBrowserAnalytics("phc_test")).toBe(true);
    expect(await startBrowserAnalytics("phc_test")).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    const [key, config] = init.mock.calls[0]!;
    expect(key).toBe("phc_test");
    expect(config).toMatchObject({
      api_host: "https://eu.i.posthog.com",
      persistence: "localStorage+cookie",
      person_profiles: "identified_only",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      cross_subdomain_cookie: false,
      respect_dnt: true,
    });
    expect(config.before_send).toBeTypeOf("function");
    expect(optIn).toHaveBeenCalledTimes(1); // andet kald genbruger instansen
  });

  it("sidevisninger sendes kun mens samtykket gælder, og med en renset adresse", async () => {
    const { startBrowserAnalytics, captureBrowserPageview, stopBrowserAnalytics } = await import(
      "@/lib/analytics/browser"
    );
    await captureBrowserPageview("/login");
    expect(capture).not.toHaveBeenCalled(); // intet samtykke endnu

    await startBrowserAnalytics("phc_test");
    await captureBrowserPageview("/vurdering/hemmeligt");
    expect(capture).toHaveBeenCalledWith("$pageview", {
      $current_url: `${window.location.origin}/vurdering/[token]`,
      $pathname: "/vurdering/[token]",
    });

    stopBrowserAnalytics();
    await captureBrowserPageview("/login");
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("tilbagekaldelse: opt-out, nulstil og ryd cookies + localStorage + sessionStorage (kun ph_)", async () => {
    const { startBrowserAnalytics, stopBrowserAnalytics } = await import("@/lib/analytics/browser");
    await startBrowserAnalytics("phc_test");
    document.cookie = "ph_phc_test_posthog=x; Path=/";
    document.cookie = "abaas_consent=y; Path=/";
    localStorage.setItem("ph_phc_test_posthog", "x");
    localStorage.setItem("__ph_opt_in_out_phc_test", "1");
    localStorage.setItem("andet", "bevares");
    sessionStorage.setItem("ph_session", "x");

    stopBrowserAnalytics();

    expect(optOut).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(document.cookie).not.toContain("ph_phc_test_posthog");
    expect(document.cookie).toContain("abaas_consent=y"); // vores egen cookie røres ikke
    expect(localStorage.getItem("ph_phc_test_posthog")).toBeNull();
    expect(localStorage.getItem("__ph_opt_in_out_phc_test")).toBeNull();
    expect(localStorage.getItem("andet")).toBe("bevares");
    expect(sessionStorage.getItem("ph_session")).toBeNull();
    document.cookie = "abaas_consent=; Max-Age=0; Path=/";
  });

  it("stop uden at SDK'et er hentet rydder rester, men henter intet", async () => {
    const { stopBrowserAnalytics } = await import("@/lib/analytics/browser");
    localStorage.setItem("ph_gammelt", "x");
    stopBrowserAnalytics();
    expect(localStorage.getItem("ph_gammelt")).toBeNull();
    expect(init).not.toHaveBeenCalled();
    expect(optOut).not.toHaveBeenCalled();
  });

  it("trækkes samtykket tilbage mens SDK'et hentes, initialiseres det aldrig", async () => {
    const { startBrowserAnalytics, stopBrowserAnalytics } = await import("@/lib/analytics/browser");
    const started = startBrowserAnalytics("phc_test");
    stopBrowserAnalytics(); // før import() er løst
    expect(await started).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });
});
