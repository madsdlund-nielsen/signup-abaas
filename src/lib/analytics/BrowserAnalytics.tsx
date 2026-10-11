"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { CONSENT_CHANGED_EVENT, hasConsent, type ConsentState } from "@/server/consent";
import { captureBrowserPageview, startBrowserAnalytics, stopBrowserAnalytics } from "./browser";

interface BrowserAnalyticsProps {
  apiKey: string;
  /** Valget fra cookien på request-tidspunktet; `null` = ikke valgt (så sker intet). */
  initial: ConsentState | null;
}

/**
 * Binder samtykke til browser-PostHog (ADR 0072). Ingen UI. Lytter på bannerets valg og
 * styrer SDK'et: `analytics` til → start + sidevisning; fra eller aldrig valgt → stop og ryd.
 * Uden samtykke hentes SDK'et ikke engang (se `browser.ts`).
 */
export function BrowserAnalytics({ apiKey, initial }: BrowserAnalyticsProps) {
  const [consent, setConsent] = useState<ConsentState | null>(initial);
  const pathname = usePathname();
  const allowed = consent !== null && hasConsent(consent, "analytics");

  useEffect(() => {
    const onChange = (event: Event) => setConsent((event as CustomEvent<ConsentState>).detail);
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (!allowed) {
      stopBrowserAnalytics();
      return;
    }
    let cancelled = false;
    void startBrowserAnalytics(apiKey).then((started) => {
      if (started && !cancelled) void captureBrowserPageview(pathname);
    });
    return () => {
      cancelled = true;
    };
  }, [allowed, apiKey, pathname]);

  return null;
}
