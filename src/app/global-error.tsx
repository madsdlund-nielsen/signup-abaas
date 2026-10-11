"use client";

import { useEffect } from "react";

import "@/styles/design-tokens.css";
import "@/styles/globals.css";
import "@/styles/components.css";

import { ErrorPage } from "@/components/ErrorPage";
import { PrimaryButton } from "@/components/PrimaryButton";

/**
 * Fejl i selve rodlayoutet (fase 6.2, ADR 0070). Erstatter layoutet, så den skal bringe sit
 * eget `<html>`/`<body>` og sine egne stylesheets — ellers står siden uden tokens. Ingen
 * header/fod her: de hører til det layout der netop er gået i stykker, og et link tilbage
 * til forsiden er en hård navigation (`<a>`), der genstarter appen rent.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="da">
      <body>
        <title>Noget gik galt — Advisory Board Unlimited</title>
        <ErrorPage
          eyebrow="Noget gik galt"
          title="Vi kunne ikke vise siden."
          reference={error.digest}
          actions={
            <>
              <PrimaryButton onClick={() => retry()}>Prøv igen</PrimaryButton>
              {/* Bevidst hård navigation: en Link ville beholde det ødelagte layout i hukommelsen. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a className="btn-ghost" href="/">
                Til forsiden
              </a>
            </>
          }
        >
          Fejlen ligger hos os, ikke hos dig. Prøv igen om et øjeblik. Hjælper det ikke, så skriv
          til info@signupacademy.com.
        </ErrorPage>
      </body>
    </html>
  );
}
