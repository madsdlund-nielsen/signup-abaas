import { Stat, formatTimestamp } from "@/components/OpsOverview";
import { ACTIVE_WINDOW_DAYS, EVENT_WINDOW_HOURS, type PostHogOps } from "@/server/admin";

/**
 * "Drift (PostHog)" på /admin/drift (fase 5.4, ADR 0066). Ren præsentation med tre tilstande:
 * tal, "ikke koblet på" og "kunne ikke læses". En manglende læsenøgle og en fejlet læsning er
 * to forskellige ting og siges forskelligt — og ingen af dem viser nuller (stub-politikken).
 */
export function PostHogOpsSection({ posthog }: { posthog: PostHogOps }) {
  return (
    <section className="stack section-rule">
      <p className="eyebrow">Drift (PostHog)</p>

      {posthog.state === "not_configured" ? (
        <p className="empty">
          Ikke koblet på — mangler PostHog-læsenøgle (POSTHOG_PERSONAL_API_KEY og POSTHOG_PROJECT_ID, med
          FLAG_ANALYTICS). Indtil da kan fejl og ydelse ses direkte i{" "}
          <a href="https://eu.posthog.com" rel="noreferrer noopener" target="_blank">
            PostHog (EU)
          </a>
          .
        </p>
      ) : null}

      {posthog.state === "unreadable" ? (
        <p className="empty">
          Kunne ikke læses fra PostHog — se serverlog. Tallene er derfor ikke nuller; resten af siden er upåvirket.
        </p>
      ) : null}

      {posthog.state === "ok" ? (
        <>
          {posthog.source === "demo" ? (
            <p className="form__notice" role="status">
              [DEMO] Åbenlyst falske tal — PostHog-læsenøglen mangler, og FLAG_DEMO er tændt. Intet herunder er målt.
            </p>
          ) : null}
          <p className="factline">
            <span>Læst {formatTimestamp(posthog.generatedAt)}</span>
          </p>
          <div className="stats">
            <Stat label={`Hændelser, seneste ${EVENT_WINDOW_HOURS} timer`} value={posthog.metrics.events} />
            <Stat label={`Undtagelser, seneste ${EVENT_WINDOW_HOURS} timer`} value={posthog.metrics.exceptions} />
            <Stat label={`Aktive personer, seneste ${ACTIVE_WINDOW_DAYS} dage`} value={posthog.metrics.activePeople} />
          </div>
          {posthog.metrics.topExceptionTypes.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="table__head">Hyppigste fejltyper</th>
                    <th className="table__head">Antal</th>
                  </tr>
                </thead>
                <tbody>
                  {posthog.metrics.topExceptionTypes.map((item) => (
                    <tr key={item.type} className="table__row">
                      <td className="table__cell">{item.type}</td>
                      <td className="table__cell">{item.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Ingen undtagelser registreret i perioden.</p>
          )}
          <p className="body">Kun tællinger og fejltypenavne — ingen personer, ingen fejlbeskeder.</p>
        </>
      ) : null}
    </section>
  );
}
