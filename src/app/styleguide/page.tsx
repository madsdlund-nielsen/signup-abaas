import { Card } from "@/components/Card";
import { Eyebrow } from "@/components/Eyebrow";
import { Heading } from "@/components/Heading";
import { PageHeader } from "@/components/PageHeader";
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

      <SectionBand tone="white">
        <div className="stack">
          <Eyebrow>App-flader</Eyebrow>
          <Heading level={2}>Sidehoved, paneler og tilstande</Heading>
          <p className="body measure">
            Forsidens bånd er redaktionelle. De signerede sider bruger et kompakt navy sidehoved og
            paneler — samme kontrast, mindre luft, fordi et sidehoved er orientering og ikke en
            sektion.
          </p>
        </div>
      </SectionBand>

      <PageHeader
        eyebrow="Styleguide · Sidehoved"
        title="Sådan ser et sidehoved ud"
        lead="Brødkrumme, tynd overskrift og en underrubrik der forklarer hvad man kan på siden."
      />

      <SectionBand tone="white">
        <div className="stack">
          <div className="panel-grid">
            <div className="panel">
              <Heading level={3}>Panel</Heading>
              <p className="body">
                Manualens eneste legitime brug af skygge — aldrig på knapper, kort eller mærker.
              </p>
              <button className="btn-secondary" type="button">
                Sekundær handling
              </button>
            </div>
            <div className="panel">
              <Heading level={3}>Faktalinje</Heading>
              <p className="factline">
                <span>60 min møde</span>
                <span>·</span>
                <span>15 min forberedelse</span>
                <span>·</span>
                <span>3 rådgivere</span>
              </p>
            </div>
            <div className="panel">
              <Heading level={3}>Tom tilstand</Heading>
              <p className="empty">
                Ingen møder endnu. En tom tilstand er rolig og ærlig, ikke en fejl.
              </p>
            </div>
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
