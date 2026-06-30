import { Card } from "@/components/Card";
import { Eyebrow } from "@/components/Eyebrow";
import { Heading } from "@/components/Heading";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionBand } from "@/components/SectionBand";
import { TopBar } from "@/components/TopBar";

/**
 * Levende reference for design-fundamentet. Intern styleguide — kan flag-gates
 * senere. Alt renderes udelukkende via komponenter + tokens.
 */
export default function Styleguide() {
  return (
    <>
      <TopBar>
        <span>Advisory Board Unlimited</span>
        <span>kontakt@signupacademy.com</span>
      </TopBar>

      <SectionBand tone="navy">
        <div className="stack">
          <Eyebrow>Styleguide</Eyebrow>
          <Heading level={1} onDark>
            Et rådgivende board, sammensat til din virksomhed.
          </Heading>
          <p className="body body--on-dark measure">
            Komponentlaget bygger udelukkende på design-tokens: firkantede former, tynde
            overskrifter, Open Sans og guld som sparsom accent.
          </p>
          <PrimaryButton>Kom i gang</PrimaryButton>
        </div>
      </SectionBand>

      <SectionBand tone="white">
        <div className="stack">
          <Eyebrow>Komponenter</Eyebrow>
          <Heading level={2}>Kort</Heading>
          <div className="card-grid">
            <Card title="Strategi" />
            <Card title="Vækst" />
            <Card title="Drift" />
          </div>
        </div>
      </SectionBand>

      <SectionBand tone="grey">
        <div className="stack">
          <Eyebrow>Typeskala</Eyebrow>
          <Heading level={1}>Overskrift niveau 1</Heading>
          <Heading level={2}>Overskrift niveau 2</Heading>
          <Heading level={3}>Overskrift niveau 3</Heading>
          <p className="body measure">
            Brødtekst i redaktionel, luftig leading. Knappen nedenfor er kanon-CTA-knappen.
          </p>
          <PrimaryButton>Sekundær handling</PrimaryButton>
        </div>
      </SectionBand>
    </>
  );
}
