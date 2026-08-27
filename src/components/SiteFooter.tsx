import Image from "next/image";
import Link from "next/link";

/**
 * Afsenderfod på charcoal. Bruger kortform 05 — mærket med navnelinjen — fordi foden er det
 * ene sted i UI'et hvor mærket står som afsender frem for som navigation, og hvor der er
 * plads til dens 320 px-minimum (designmanual v1.2, side 08).
 *
 * Guld optræder ikke her ud over inde i selve mærket: manualens guldbudget er ca. 5 % af en
 * flade, og en fod med guldlinks ville bruge det på det mindst betydningsfulde sted på siden.
 */
export function SiteFooter() {
  return (
    <footer className="sitefooter">
      <div className="sitefooter__inner">
        <Image
          className="sitefooter__mark"
          src="/brand/abu-mark-05-light-on-dark.svg"
          alt="Advisory Board Unlimited"
          width={320}
          height={320}
        />
        <div className="sitefooter__cols">
          <div className="stack">
            <p className="eyebrow eyebrow--on-dark">Platformen</p>
            <Link href="/board">Dit board</Link>
            <Link href="/moeder">Møder</Link>
            <Link href="/betaling">Abonnement</Link>
          </div>
          <div className="stack">
            <p className="eyebrow eyebrow--on-dark">Konto</p>
            <Link href="/login">Log ind</Link>
            <Link href="/signup">Opret konto</Link>
          </div>
        </div>
      </div>
      <div className="sitefooter__base">
        <p className="sitefooter__colophon">SignUp Academy · CVR DK-38913557</p>
      </div>
    </footer>
  );
}
