import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { isDemoMode } from "@/server/flags";

import { DemoBadge } from "./DemoBadge";
import { SiteNav } from "./SiteNav";

/**
 * Header-bar — én af designmanualens fire kanoniske former (v1.2, side 14):
 * "Løsen i invers, venstrestillet. Aldrig kortform 05 i en header — den kræver 320 px."
 *
 * Mærkevalget er ikke en smagssag. Manualens skalatabel (side 08) binder hvert mærke til
 * det punkt hvor dets tyndeste streg rammer én pixel:
 *   * ordmærket (lockup-22) må bruges fra 300 px bredde
 *   * kortform 01 SemiBold dækker 32–96 px
 * En header skal fungere på en telefon, hvor 300 px løse ikke er til rådighed. Derfor
 * skifter vi til det kvadratiske mærke under den grænse — ikke ved at skalere løsen ned
 * under sit minimum, hvilket ville lade "unlimited" rendere gråt.
 *
 * Både løsen og kortformen ligger i DOM'en; CSS vælger. Det er bevidst: et JS-baseret skift
 * ville give et synligt hop ved hydrering på hver eneste sideindlæsning.
 *
 * Komponenten er bevidst SYNKRON og rører ikke sessionen (ADR 0050). Den lå før i
 * rodlayoutet og ventede på getCurrentUser(), hvilket gjorde hver eneste rute dynamisk og
 * lod hele siden vente på en rundtur til Supabase før første byte. Det auth-afhængige led
 * er flyttet til SiteNav bag en Suspense-grænse; kromet sendes af sted med det samme.
 */
export function SiteHeader() {
  return (
    <header className="siteheader">
      <div className="siteheader__inner">
        <Link
          className="siteheader__brand"
          href="/"
          aria-label="Advisory Board Unlimited — forside"
        >
          <Image
            className="siteheader__lockup"
            src="/brand/advisory-board-unlimited-lockup-22.svg"
            alt="Advisory Board Unlimited"
            width={300}
            height={30}
            priority
          />
          <Image
            className="siteheader__mark"
            src="/brand/abu-mark-01-small-light-on-dark.svg"
            alt="Advisory Board Unlimited"
            width={40}
            height={40}
            priority
          />
        </Link>

        <nav className="siteheader__nav" aria-label="Primær">
          {/* Demo-mærket (ADR 0041) står på hver side i demo-tilstand — og er væk ellers. */}
          {isDemoMode() ? <DemoBadge /> : null}
          {/* Auth-afhængig del streames ind (ADR 0050). Fallback er tom frem for
              udlogget-nav'en: en kort tom plads er ærligere end at vise "Log ind" til
              en der ER logget ind. */}
          <Suspense fallback={null}>
            <SiteNav />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}
