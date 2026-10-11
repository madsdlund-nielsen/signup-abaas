"use client";

import Link from "next/link";
import { useEffect } from "react";

import { ErrorPage } from "@/components/ErrorPage";
import { PrimaryButton } from "@/components/PrimaryButton";

/**
 * Runtime-fejl i en rute (fase 6.2, ADR 0070). Viser aldrig `error.message` eller en
 * stacktrace — i produktion er beskeden fra serveren alligevel anonymiseret, og i en klient-
 * fejl kan den indeholde det vi ikke vil vise. `digest` er en hash, der kun kan slås op i
 * serverloggen, og er derfor sikker at vise som reference til support.
 */
export default function RouteError({
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
    <ErrorPage
      eyebrow="Noget gik galt"
      title="Vi kunne ikke vise siden."
      reference={error.digest}
      actions={
        <>
          <PrimaryButton onClick={() => retry()}>Prøv igen</PrimaryButton>
          <Link className="btn-ghost" href="/">
            Til forsiden
          </Link>
        </>
      }
    >
      Fejlen ligger hos os, ikke hos dig. Prøv igen om et øjeblik. Hjælper det ikke, så skriv til
      info@signupacademy.com.
    </ErrorPage>
  );
}
