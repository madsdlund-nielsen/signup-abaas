import type { ReactNode } from "react";

import type {
  IntegrationMode,
  IntegrationOverview,
  IntegrationStatus,
  OpsOverview as OpsOverviewState,
  WebhookEvent,
} from "@/server/admin";

/**
 * Driftsoverblikket (fase 5.4, ADR 0053). Ren præsentation: tal først, så tabeller. Skærmen
 * lover ikke mere end den ved — en sektion der ikke kunne læses viser "—" og siger hvorfor,
 * aldrig et nul (docs/stub-politik.md: synlige huller frem for stille gæt).
 */

const MODE_LABEL: Record<IntegrationMode, string> = {
  real: "Rigtig",
  demo: "Demo",
  stub: "Stub",
};

/** Ét tal med label. `null` = sektionen kunne ikke læses. */
export function Stat({ label, value, atLeast = false }: { label: string; value: number | null; atLeast?: boolean }) {
  return (
    <div className="stat">
      <p className="stat__value">{value === null ? "—" : `${atLeast ? "≥ " : ""}${value}`}</p>
      <p className="stat__label">{label}</p>
    </div>
  );
}

function StatSection({
  title,
  unreadable,
  children,
}: {
  title: string;
  /** Sand når sektionens data ikke kunne hentes. */
  unreadable: boolean;
  children: ReactNode;
}) {
  return (
    <section className="stack section-rule">
      <p className="eyebrow">{title}</p>
      {unreadable ? (
        <p className="empty">Kunne ikke læses — se serverlog. Tallene herunder er derfor ikke nuller.</p>
      ) : null}
      {children}
    </section>
  );
}

/** Dato + klokkeslæt i dansk format. Ren, så den kan testes og ikke afhænger af serverens tidszone. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("da-DK", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Copenhagen",
  }).format(date);
}

function WebhookTable({ title, events }: { title: string; events: readonly WebhookEvent[] }) {
  return (
    <div className="stack">
      <p className="eyebrow">{title}</p>
      {events.length === 0 ? (
        <p className="empty">Ingen hændelser modtaget endnu.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="table__head">Modtaget</th>
                <th className="table__head">Leverandør</th>
                <th className="table__head">Hændelse</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, index) => (
                <tr key={`${event.receivedAt}-${index}`} className="table__row">
                  <td className="table__cell">{formatTimestamp(event.receivedAt)}</td>
                  <td className="table__cell">{event.provider}</td>
                  <td className="table__cell">{event.eventType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Én linje om hvad en integration kan i dag — og hvis den ikke er rigtig, hvad der mangler. */
export function integrationNote(item: IntegrationStatus): string {
  if (item.mode === "real") return "Kører mod leverandøren.";
  if (item.mode === "demo") return "Åbenlyst falsk data (FLAG_DEMO) — rigtig config mangler.";
  return item.flagEnabled
    ? `Flaget er tændt, men nøglerne mangler — ${item.flagEnv}.`
    : `Flaget er slukket — ${item.flagEnv}.`;
}

export function IntegrationStatusTable({ overview }: { overview: IntegrationOverview }) {
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="table__head">Port</th>
              <th className="table__head">Leverandør</th>
              <th className="table__head">Kører</th>
              <th className="table__head">Flag</th>
              <th className="table__head">Note</th>
            </tr>
          </thead>
          <tbody>
            {overview.integrations.map((item) => (
              <tr key={item.key} className="table__row">
                <td className="table__cell">{item.label}</td>
                <td className="table__cell">{item.vendor}</td>
                <td className="table__cell">{MODE_LABEL[item.mode]}</td>
                <td className="table__cell">{item.flagEnabled ? "Tændt" : "Slukket"}</td>
                <td className="table__cell">{integrationNote(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="factline">
        <span>{overview.counts.real} rigtige</span>
        <span>{overview.counts.demo} demo</span>
        <span>{overview.counts.stub} stub</span>
      </p>
      {overview.demoMode ? (
        <p className="form__notice" role="status">
          FLAG_DEMO er tændt. Demo-tilstand skal være slået fra før launch (docs/fase-6.md §6.4).
        </p>
      ) : null}
    </div>
  );
}

export function OpsOverview({
  ops,
  integrations,
}: {
  /** `null` når Supabase ikke er konfigureret. */
  ops: OpsOverviewState | null;
  integrations: IntegrationOverview;
}) {
  const platform = ops?.platform ?? null;
  const memberships = ops?.memberships ?? null;
  const charges = ops?.charges ?? null;
  const meetings = ops?.meetings ?? null;
  const missing = ops?.missingRegistrations ?? null;
  const webhooks = ops?.webhooks ?? null;
  const atLeast = ops?.truncated ?? false;

  return (
    <div className="stack">
      {ops === null ? (
        <p className="empty">
          Supabase er ikke konfigureret i dette miljø, så der er ingen driftstal at vise. Integrationsstatus
          nedenfor kræver ingen database.
        </p>
      ) : (
        <>
          {atLeast ? (
            <p className="form__notice" role="status">
              Mindst én sektion nåede rækkegrænsen på 1000. Tal markeret ≥ er et gulv, ikke totalen.
            </p>
          ) : null}

          <StatSection title="Platform" unreadable={platform === null}>
            <div className="stats">
              <Stat label="Boards" value={platform?.boards ?? null} atLeast={atLeast} />
              <Stat label="Ejere med board" value={platform?.ownersWithBoard ?? null} atLeast={atLeast} />
              <Stat label="Partnere" value={platform?.partners ?? null} atLeast={atLeast} />
              <Stat label="Koblet til login" value={platform?.partnersLinked ?? null} atLeast={atLeast} />
              <Stat label="Uden login" value={platform?.partnersUnlinked ?? null} atLeast={atLeast} />
            </div>
          </StatSection>

          <StatSection title="Medlemskaber" unreadable={memberships === null}>
            <div className="stats">
              <Stat label="I alt" value={memberships?.total ?? null} atLeast={atLeast} />
              <Stat label="Aktive" value={memberships?.active ?? null} atLeast={atLeast} />
              <Stat label="Opsagt" value={memberships?.cancelled ?? null} atLeast={atLeast} />
              <Stat label="Kort registreret" value={memberships?.cardRegistered ?? null} atLeast={atLeast} />
              <Stat label="Kort mangler" value={memberships?.cardMissing ?? null} atLeast={atLeast} />
            </div>
          </StatSection>

          <StatSection title="Betalingstræk" unreadable={charges === null}>
            <div className="stats">
              <Stat label="Afventer" value={charges?.pending ?? null} atLeast={atLeast} />
              <Stat label="Gennemført" value={charges?.succeeded ?? null} atLeast={atLeast} />
              <Stat label="Fejlet" value={charges?.failed ?? null} atLeast={atLeast} />
            </div>
            {charges && charges.recentFailures.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="table__head">Fejlet</th>
                      <th className="table__head">Årsag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charges.recentFailures.map((failure) => (
                      <tr key={failure.id} className="table__row">
                        <td className="table__cell">{formatTimestamp(failure.failedAt)}</td>
                        <td className="table__cell">{failure.reason ?? "Ingen årsag modtaget"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </StatSection>

          <StatSection title="Møder" unreadable={meetings === null && missing === null}>
            <div className="stats">
              <Stat label="Kommende" value={meetings?.upcoming ?? null} atLeast={atLeast} />
              <Stat
                label={`Afholdt, seneste ${meetings?.windowDays ?? 30} dage`}
                value={meetings?.held ?? null}
                atLeast={atLeast}
              />
              <Stat
                label={`Aflyst, seneste ${meetings?.windowDays ?? 30} dage`}
                value={meetings?.cancelled ?? null}
                atLeast={atLeast}
              />
              <Stat label="Planlagt, men tiden er passeret" value={meetings?.overdue ?? null} atLeast={atLeast} />
              <Stat
                label="Afholdte møder uden partner-registrering"
                value={missing?.meetings ?? null}
                atLeast={atLeast}
              />
              <Stat label="Manglende partner-registreringer" value={missing?.registrations ?? null} atLeast={atLeast} />
            </div>
          </StatSection>

          <StatSection title="Webhooks" unreadable={webhooks === null}>
            {webhooks ? (
              <>
                <WebhookTable title="Møde-webhooks" events={webhooks.meeting} />
                <WebhookTable title="Betalings-webhooks" events={webhooks.payment} />
              </>
            ) : null}
          </StatSection>
        </>
      )}

      <section className="stack section-rule">
        <p className="eyebrow">Integrationer</p>
        <IntegrationStatusTable overview={integrations} />
      </section>
    </div>
  );
}
