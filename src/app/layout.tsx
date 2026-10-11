import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "@/styles/design-tokens.css";
import "@/styles/globals.css";
import "@/styles/components.css";

import { CookieBanner } from "@/components/CookieBanner";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { TopBar } from "@/components/TopBar";
import { BrowserAnalytics } from "@/lib/analytics/BrowserAnalytics";
import { readBrowserAnalyticsConfig, resolveConsentBoot } from "@/lib/analytics/browser-config";
import { CONSENT_COOKIE } from "@/server/consent";

export const metadata: Metadata = {
  title: "Advisory Board Unlimited",
  description: "Advisory Board as a Service — rådgivende board sammensat til din virksomhed.",
  // Favicon og app-ikon bruger det optisk korrigerede lille snit. Manualens skalatabel
  // (v1.2, side 08) binder det til 32-96 px, og et favicon lever i netop det interval:
  // Light-snittet ville rendere gråt her, fordi stregen falder under én pixel.
  icons: {
    icon: "/brand/abu-mark-01-small-navy-on-light.svg",
    apple: "/brand/abu-mark-01-small-navy-on-light.svg",
  },
};

/**
 * Layoutet er async KUN for at vente på en request (`connection()`), ikke på data. CSP-nonce'n
 * (src/proxy.ts, ADR 0070) findes først pr. request, og Next sætter den kun på de scripts og
 * styles det selv genererer under dynamisk rendering — en statisk prærenderet side ville sende
 * scripts uden nonce, som en nonce-CSP så blokerer. Det koster ingen netværkstur (til forskel
 * fra sessionen, ADR 0050) og ændrer ikke at nav'en streames bag sin Suspense-grænse.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  // Cookie-banneret findes kun når der er ikke-nødvendige cookies at spørge om: browser-analytics
  // slået til (FLAG_ANALYTICS + NEXT_PUBLIC_POSTHOG_KEY). Ellers renderes intet (ADR 0072).
  // Cookies læses kun i det tilfælde; layoutet er allerede dynamisk (nonce, ADR 0070).
  const boot = readBrowserAnalyticsConfig()
    ? resolveConsentBoot(process.env, (await cookies()).get(CONSENT_COOKIE)?.value)
    : null;
  return (
    <html lang="da">
      <body>
        <a className="skiplink" href="#main">
          Spring til indhold
        </a>
        {boot && <CookieBanner initial={boot.initial} />}
        {boot && <BrowserAnalytics apiKey={boot.apiKey} initial={boot.initial} />}
        {/* Samme krom som signupacademy.com: tynd navy kontaktbar over header-baren (ADR 0044). */}
        <TopBar>
          <a href="mailto:info@signupacademy.com">info@signupacademy.com</a>
          <a href="tel:+4531139580">+45 3113 9580</a>
        </TopBar>
        <SiteHeader />
        {children}
        <SiteFooter cookieSettings={boot !== null} />
      </body>
    </html>
  );
}
