import type { ReactNode } from "react";

/**
 * Sidehoved til de signerede flader (ADR 0039). Et kompakt navy-bånd med brødkrumme,
 * tynd overskrift og valgfri underrubrik — hvorefter indholdet står på hvidt.
 *
 * Hvorfor et bånd og ikke bare en overskrift: designmanualen kalder den vekslende rytme
 * brandets tredje signatur, og "skiftet bærer siden". På forsiden er skiftet redaktionelt
 * (90 px bånd); her er det funktionelt — det adskiller "hvor er jeg" fra "hvad kan jeg
 * gøre" uden at bruge en eneste streg, boks eller skygge på det.
 *
 * Båndet er navy, ikke charcoal: manualen tildeler charcoal til hero, header-bar og
 * fotobaggrunde, og navy til sektionsbånd og paneler. Site-headeren ovenfor er charcoal,
 * så et charcoal sidehoved ville smelte sammen med den.
 */
export function PageHeader({
  eyebrow,
  title,
  lead,
  actions,
}: {
  /** Brødkrumme eller sektionsnavn. Versal-UI sættes af .eyebrow. */
  eyebrow: ReactNode;
  title: string;
  lead?: ReactNode;
  /** Primær handling der hører til siden som helhed, ikke til et enkelt element. */
  actions?: ReactNode;
}) {
  return (
    <section className="pagehead">
      <div className="pagehead__inner">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="heading-2 heading--on-dark">{title}</h1>
        {lead ? <p className="lead lead--on-dark measure">{lead}</p> : null}
        {actions ? <div className="row-form pagehead__actions">{actions}</div> : null}
      </div>
    </section>
  );
}

/**
 * Indholdsfladen under sidehovedet. Bærer den lodrette luft, så hver side ikke skal
 * gentage den — og så rytmen er ens overalt.
 */
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <main className="pagebody">
      <div className="pagebody__inner stack">{children}</div>
    </main>
  );
}
