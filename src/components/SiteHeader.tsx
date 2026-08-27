import Image from "next/image";
import Link from "next/link";

import { getCurrentUser } from "@/server/auth";

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
 */
export async function SiteHeader() {
  const user = await getCurrentUser();

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
          {user ? (
            <>
              <Link href="/dashboard">Dashboard</Link>
              {user.roles.includes("ejer") ? <Link href="/moeder">Møder</Link> : null}
              {user.roles.includes("partner") ? <Link href="/partner">Partner</Link> : null}
              {user.roles.includes("admin") ? <Link href="/admin">Admin</Link> : null}
            </>
          ) : (
            <>
              <Link href="/login">Log ind</Link>
              <Link className="btn-primary btn-primary--compact" href="/signup">
                Kom i gang
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
