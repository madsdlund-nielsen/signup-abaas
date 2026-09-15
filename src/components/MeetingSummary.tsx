import type { MeetingSummaryState } from "@/server/summaries";

/**
 * Opsummeringen af et afholdt møde (fase 4.4, skærm-først). Ren præsentation: kilde,
 * referat og handlingspunkter — eller det synlige hul, når AI-opfølgning ikke er
 * konfigureret. Redaktionel som resten af mødesiden: ingen bokse, ingen badges.
 */
export function MeetingSummary({ state }: { state: MeetingSummaryState }) {
  if (state.kind === "unavailable") {
    return <p className="empty">{state.reason}</p>;
  }

  return (
    <div className="stack">
      <p className="factline">
        <span>{state.source === "demo" ? "Demo-opsummering" : "Genereret af Ordbogen"}</span>
        <span>Kun synlig for dig</span>
      </p>
      <p className="body">{state.summary}</p>
      {state.actionItems.length > 0 ? (
        <>
          <p className="eyebrow">Handlingspunkter</p>
          <ol className="summary-actions">
            {state.actionItems.map((item) => (
              <li key={item} className="body">
                {item}
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </div>
  );
}
