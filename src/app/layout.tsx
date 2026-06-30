import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/styles/design-tokens.css";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Advisory Board Unlimited",
  description: "Advisory Board as a Service — rådgivende board sammensat til din virksomhed.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body>{children}</body>
    </html>
  );
}
