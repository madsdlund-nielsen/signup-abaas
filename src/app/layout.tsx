import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "@/styles/design-tokens.css";
import "@/styles/globals.css";
import "@/styles/components.css";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { TopBar } from "@/components/TopBar";

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
  return (
    <html lang="da">
      <body>
        <a className="skiplink" href="#main">
          Spring til indhold
        </a>
        {/* Samme krom som signupacademy.com: tynd navy kontaktbar over header-baren (ADR 0044). */}
        <TopBar>
          <a href="mailto:info@signupacademy.com">info@signupacademy.com</a>
          <a href="tel:+4531139580">+45 3113 9580</a>
        </TopBar>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
