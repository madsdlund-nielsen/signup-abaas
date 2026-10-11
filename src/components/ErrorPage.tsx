import type { ReactNode } from "react";

import { SectionBand } from "./SectionBand";

/**
 * Fælles flade for 404, runtime-fejl og global fejl (fase 6.2, ADR 0070). Samme charcoal
 * hero-bånd som forsiden — en fejl skal føles som en del af det samme rolige hus, ikke som
 * browserens standardside. Ingen ny CSS: kun eksisterende bånd-, overskrifts- og knaptokens.
 *
 * Komponenten er bevidst en ren præsentationskomponent uden hooks, så den kan bruges både i
 * server-`not-found` og i klient-`error`/`global-error`. Ingen stacktraces og ingen
 * fejlbeskeder — kun en valgfri `reference` (Nexts `digest`), som supporten kan slå op i loggen.
 */
export function ErrorPage({
  eyebrow,
  title,
  children,
  reference,
  actions,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  /** Fejlreference (digest). Vises kun når den findes. */
  reference?: string;
  actions: ReactNode;
}) {
  return (
    <main id="main">
      <SectionBand tone="charcoal" hero>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="heading-1 heading--on-dark measure-wide">{title}</h1>
        <p className="lead lead--on-dark">{children}</p>
        {reference ? (
          <p className="body body--on-dark">Fejlreference: {reference}</p>
        ) : null}
        <div className="row-form">{actions}</div>
      </SectionBand>
    </main>
  );
}
