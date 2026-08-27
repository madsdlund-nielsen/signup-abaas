import Link from "next/link";
import type { Metadata } from "next";

import { SectionBand } from "@/components/SectionBand";

export const metadata: Metadata = {
  title: "Advisory Board Unlimited",
  description:
    "Et rådgivende board på 2-3 erfarne partnere, sammensat til din virksomhed. Faste møder, fast pris.",
};

/**
 * Forsiden. Bygget på designmanualens sektionsrytme (v1.2, side 11): vekslende bånd —
 * charcoal hero, hvid, lysegrå, navy — med ~90 px lodret luft. "Skiftet bærer siden";
 * der er hverken dekoration, gradienter eller skygger til at gøre arbejdet.
 *
 * Guld optræder på tre elementer i alt: de tre eyebrows og de to CTA'er. Det holder
 * accenten inden for manualens budget på ca. 5 % af fladen.
 */
export default function Home() {
  return (
    <>
      <SectionBand tone="charcoal">
        <p className="eyebrow">Advisory Board as a Service</p>
        <h1 className="heading-1 heading--on-dark measure-wide">
          Et rådgivende board, sammensat til din virksomhed.
        </h1>
        <p className="lead lead--on-dark">
          To til tre erfarne partnere, matchet på de udfordringer du faktisk står med. I mødes
          fast — og de møder forberedt op.
        </p>
        <div className="row-form">
          <Link className="btn-primary" href="/signup">
            Kom i gang
          </Link>
          <Link className="btn-ghost" href="/login">
            Log ind
          </Link>
        </div>
      </SectionBand>

      <SectionBand tone="white">
        <p className="eyebrow">Sådan virker det</p>
        <h2 className="heading-2 heading--on-light measure-wide">
          Fra spørgeskema til siddende board på under en uge.
        </h2>
        <ol className="steps">
          <li className="steps__item">
            <p className="steps__num">01</p>
            <h3 className="heading-3 heading--on-light">Fortæl hvor det gør ondt</h3>
            <p className="body">
              En kort samtale-guidet quiz oversætter dine udfordringer til kompetencer — ikke
              til brancheklichéer.
            </p>
          </li>
          <li className="steps__item">
            <p className="steps__num">02</p>
            <h3 className="heading-3 heading--on-light">Få dit board foreslået</h3>
            <p className="body">
              Vi sammensætter 2-3 partnere så dine vigtigste kompetencebehov er dækket, og du
              ser hvorfor hver enkelt er valgt.
            </p>
          </li>
          <li className="steps__item">
            <p className="steps__num">03</p>
            <h3 className="heading-3 heading--on-light">Mødes fast</h3>
            <p className="body">
              60 minutters møde hver fjerde, ottende eller tolvte uge. Dine partnere har 15
              betalte minutter til at forberede sig hver gang.
            </p>
          </li>
        </ol>
      </SectionBand>

      <SectionBand tone="grey">
        <p className="eyebrow">Hvad du får</p>
        <h2 className="heading-2 heading--on-light measure-wide">
          Erfaring du ellers skulle ansætte dig til.
        </h2>
        <div className="feature-grid">
          <div className="stack">
            <h3 className="heading-3 heading--on-light">Forberedte rådgivere</h3>
            <p className="body">
              Forberedelsen er betalt og indbygget. Du bruger ikke de første tyve minutter på
              at bringe nogen op i omdrejninger.
            </p>
          </div>
          <div className="stack">
            <h3 className="heading-3 heading--on-light">Ét board, ikke en vikarpulje</h3>
            <p className="body">
              De samme partnere følger virksomheden over tid. En lead-partner holder tråden
              mellem møderne.
            </p>
          </div>
          <div className="stack">
            <h3 className="heading-3 heading--on-light">Fast abonnement</h3>
            <p className="body">
              Ingen timeafregning og ingen overraskelser. Prisen følger boardets størrelse og
              hvor ofte I mødes.
            </p>
          </div>
        </div>
      </SectionBand>

      <SectionBand tone="navy">
        <p className="eyebrow">Kom i gang</p>
        <h2 className="heading-2 heading--on-dark measure-wide">
          Se hvilket board vi ville sætte sammen til dig.
        </h2>
        <p className="lead lead--on-dark">
          Quizzen tager få minutter, og du ser forslaget med det samme — før du beslutter noget.
        </p>
        <Link className="btn-primary" href="/signup">
          Byg mit board
        </Link>
      </SectionBand>
    </>
  );
}
