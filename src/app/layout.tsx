import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/styles/design-tokens.css";
import "@/styles/globals.css";
import "@/styles/components.css";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
