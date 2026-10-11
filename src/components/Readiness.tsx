import type { ReactNode } from "react";

import { Stat } from "@/components/OpsOverview";
import { StatusBadge } from "@/components/StatusBadge";
import type { PortReadiness, ReadinessReport, SecretRow, Verdict } from "@/server/admin";

/**
 * Go-live-tjekliste (fase 6.4, ADR 0069). Ren præsentation af `ReadinessReport`: tal først, så
 * tabeller. Hvert punkt har et ord og et mærke — «Klar» eller «Blokerer» — så farven aldrig
 * bærer betydningen alene. Intet her er en værdi fra miljøet; kun navne og «sat/mangler».
 */

const VERDICT_LABEL: Record<Verdict, string> = { klar: "Klar", blokerer: "Blokerer" };

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <StatusBadge tone={verdict === "klar" ? "live" : "blocked"}>{VERDICT_LABEL[verdict]}</StatusBadge>;
}

const MODE_LABEL: Record<PortReadiness["mode"], string> = { real: "Rigtig", demo: "Demo", stub: "Stub" };
const KEY_STATE_LABEL: Record<SecretRow["state"], string> = {
  sat: "Sat",
  mangler: "Mangler",
  "for-kort": "For kort",
};
const OWNER_LABEL = { ejer: "Ejer", mads: "Mads" } as const;

/** «A eller B» — navnene på de variabler et krav kan opfyldes af. */
export function envNamesLabel(names: readonly string[]): string {
  return names.join(" eller ");
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="stack section-rule">
      <p className="eyebrow">{title}</p>
      {children}
    </section>
  );
}

function Table({ head, children }: { head: readonly string[]; children: ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {head.map((label) => (
              <th key={label} className="table__head">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Overview({ report }: { report: ReadinessReport }) {
  const { summary, ports, secrets, rules, decisions } = report;
  const requiredSecrets = secrets.filter((secret) => secret.required);
  const realPorts = ports.filter((port) => port.mode === "real").length;
  return (
    <div className="stats">
      <Stat label="Blokeringer i alt" value={summary.totalBlockers} />
      <Stat label={`Integrationer rigtige af ${ports.length}`} value={realPorts} />
      <Stat
        label={`Hemmeligheder sat af ${requiredSecrets.length}`}
        value={requiredSecrets.filter((secret) => secret.state === "sat").length}
      />
      <Stat
        label={`Skabeloner live af ${rules?.templates.totalCount ?? 0}`}
        value={rules ? rules.templates.liveCount : null}
      />
      <Stat label="Åbne beslutninger" value={decisions.open.length} />
    </div>
  );
}

function PortsTable({ ports }: { ports: readonly PortReadiness[] }) {
  return (
    <Table head={["Port", "Leverandør", "Kører", "Flag", "Status", "Note"]}>
      {ports.map((port) => (
        <tr key={port.key} className="table__row">
          <td className="table__cell">{port.label}</td>
          <td className="table__cell">{port.vendor}</td>
          <td className="table__cell">{MODE_LABEL[port.mode]}</td>
          <td className="table__cell">{port.flagEnabled ? "Tændt" : "Slukket"}</td>
          <td className="table__cell">
            <VerdictBadge verdict={port.verdict} />
          </td>
          <td className="table__cell">{port.reason}</td>
        </tr>
      ))}
    </Table>
  );
}

function SecretsTable({ secrets }: { secrets: readonly SecretRow[] }) {
  return (
    <Table head={["Gruppe", "Hemmelighed", "Variabel", "Tilstand", "Status"]}>
      {secrets.map((secret) => (
        <tr key={`${secret.group}/${secret.label}`} className="table__row">
          <td className="table__cell">{secret.group}</td>
          <td className="table__cell">{secret.label}</td>
          <td className="table__cell">{envNamesLabel(secret.envNames)}</td>
          <td className="table__cell">{secret.required ? KEY_STATE_LABEL[secret.state] : "Ikke påkrævet"}</td>
          <td className="table__cell">
            <VerdictBadge verdict={secret.verdict} />
          </td>
        </tr>
      ))}
    </Table>
  );
}

function RulesSection({ rules }: { rules: ReadinessReport["rules"] }) {
  if (rules === null) {
    return (
      <p className="empty">
        Reglerne kunne ikke læses — Supabase er ikke konfigureret, eller forespørgslen fejlede (se serverlog).
        Det tæller som en blokering: «ukendt» er ikke «klar».
      </p>
    );
  }
  return (
    <>
      <Table head={["Regel", "Versioner", "Gældende", "Status", "Note"]}>
        {[
          { name: "Prisregel", section: rules.pricing },
          { name: "Honorarregel", section: rules.fee },
        ].map(({ name, section }) => (
          <tr key={name} className="table__row">
            <td className="table__cell">{name}</td>
            <td className="table__cell table__cell--num">{section.versions}</td>
            <td className="table__cell table__cell--num">
              {section.activeVersion === null ? "Ingen" : `Version ${section.activeVersion}`}
            </td>
            <td className="table__cell">
              <VerdictBadge verdict={section.verdict} />
            </td>
            <td className="table__cell">{section.reason}</td>
          </tr>
        ))}
      </Table>

      <Table head={["Beskedtype", "Kanal", "Live skabelon", "Tidspunkt", "Status"]}>
        {rules.templates.rows.map((row) => (
          <tr key={`${row.typeKey}/${row.channel}`} className="table__row">
            <td className="table__cell">{row.label}</td>
            <td className="table__cell">{row.channel === "email" ? "E-mail" : "SMS"}</td>
            <td className="table__cell">{row.liveVersion === null ? "Ingen" : `Version ${row.liveVersion}`}</td>
            <td className="table__cell">{row.timingSet ? "Fastlagt" : "Ikke fastlagt"}</td>
            <td className="table__cell">
              <VerdictBadge verdict={row.liveVersion === null ? "blokerer" : "klar"} />
            </td>
          </tr>
        ))}
      </Table>
      <p className="factline">
        <span>
          {rules.templates.liveCount} af {rules.templates.totalCount} skabeloner live
        </span>
      </p>
    </>
  );
}

function DecisionsSection({ decisions }: { decisions: ReadinessReport["decisions"] }) {
  if (decisions.open.length === 0 && decisions.parked.length === 0) {
    return <p className="empty">Ingen åbne beslutninger i datafilen.</p>;
  }
  return (
    <>
      <Table head={["Hvem", "Beslutning", "Hvad der ellers gælder", "Blokerer launch", "Kilde"]}>
        {decisions.open.map((decision) => (
          <tr key={decision.id} className="table__row">
            <td className="table__cell">{OWNER_LABEL[decision.owner]}</td>
            <td className="table__cell">{decision.title}</td>
            <td className="table__cell">{decision.consequence}</td>
            <td className="table__cell">{decision.blocksLaunch ? "Ja" : "Afklares eller parkeres"}</td>
            <td className="table__cell">{decision.source}</td>
          </tr>
        ))}
      </Table>
      {decisions.parked.length > 0 ? (
        <>
          <p className="eyebrow">Bevidst parkeret</p>
          <Table head={["Beslutning", "Parkeret af", "Dato"]}>
            {decisions.parked.map((decision) => (
              <tr key={decision.id} className="table__row">
                <td className="table__cell">{decision.title}</td>
                <td className="table__cell">{decision.parked?.by}</td>
                <td className="table__cell">{decision.parked?.date}</td>
              </tr>
            ))}
          </Table>
        </>
      ) : null}
    </>
  );
}

export function Readiness({ report }: { report: ReadinessReport }) {
  return (
    <div className="stack">
      <Overview report={report} />

      <Section title="Demo og adgangsport">
        <Table head={["Punkt", "Status", "Note"]}>
          <tr className="table__row">
            <td className="table__cell">Demo-tilstand (FLAG_DEMO)</td>
            <td className="table__cell">
              <VerdictBadge verdict={report.demo.verdict} />
            </td>
            <td className="table__cell">
              {report.demo.on
                ? "Tændt. Skal være slukket ved launch: demo-data er åbenlyst falsk, og demo-mærket vises i hver sides top."
                : "Slukket."}
            </td>
          </tr>
          <tr className="table__row">
            <td className="table__cell">Adgangsport (APP_GATE_ENABLED)</td>
            <td className="table__cell">
              <VerdictBadge verdict={report.gate.verdict} />
            </td>
            <td className="table__cell">{report.gate.reason}</td>
          </tr>
        </Table>
      </Section>

      <Section title="Integrationer">
        <PortsTable ports={report.ports} />
        <p className="factline">
          <span>{report.ports.filter((p) => p.mode === "real").length} rigtige</span>
          <span>{report.ports.filter((p) => p.mode === "demo").length} demo</span>
          <span>{report.ports.filter((p) => p.mode === "stub").length} stub</span>
        </p>
      </Section>

      <Section title="Hemmeligheder">
        <SecretsTable secrets={report.secrets} />
        <p className="factline">
          <span>Kun tilstedeværelse vises — aldrig værdier</span>
        </p>
      </Section>

      <Section title="Aktive regler">
        <RulesSection rules={report.rules} />
      </Section>

      <Section title="Øvrige flag">
        <Table head={["Flag", "Variabel", "Nu", "Dokumenteret", "Status", "Note"]}>
          {report.flags.map((flag) => (
            <tr key={flag.flag} className="table__row">
              <td className="table__cell">{flag.flag}</td>
              <td className="table__cell">{flag.env}</td>
              <td className="table__cell">{flag.enabled ? "Tændt" : "Slukket"}</td>
              <td className="table__cell">{flag.intent === null ? "Ikke dokumenteret" : `Bevidst ${flag.intent}`}</td>
              <td className="table__cell">
                <VerdictBadge verdict={flag.verdict} />
              </td>
              <td className="table__cell">{flag.reason} {flag.note}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Beslutninger der står mellem os og launch">
        <DecisionsSection decisions={report.decisions} />
      </Section>
    </div>
  );
}
