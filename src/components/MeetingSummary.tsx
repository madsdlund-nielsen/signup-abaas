import type { ReactNode } from "react";

import type { MeetingSummaryState } from "@/server/summaries";

/**
 * Opsummeringen af et afholdt møde (fase 4.4). Ren præsentation af den GEMTE række (B-45):
 * kilde, referat og handlingspunkter — eller en rolig statuslinje når resuméet endnu ikke er
 * der (på vej, mangler samtykke, mangler optagelse, opgivet) eller AI-opfølgning ikke er
 * konfigureret. Redaktionel som resten af mødesiden: ingen bokse, ingen badges.
 *
 * `retry` er en slot til "Generér igen" (en client-form med server action), som kun siden kender.
 */
export function MeetingSummary({ state, retry }: { state: MeetingSummaryState; retry?: ReactNode }) {
  switch (state.kind) {
    case "unavailable":
      return <p className="empty">{state.reason}</p>;
    case "pending":
      return (
        <p className="empty">
          Opsummeringen er på vej. Den laves automatisk efter mødet og dukker op her — du behøver
          ikke gøre noget.
        </p>
      );
    case "missing_consent":
      return (
        <p className="empty">
          Der er ikke registreret samtykke til mødeoptagelse, så mødet er hverken transskriberet
          eller opsummeret.
        </p>
      );
    case "missing_recording":
      return (
        <p className="empty">
          Mødets optagelse er ikke tilgængelig, så der kan ikke laves en opsummering. Den laves
          automatisk, hvis optagelsen dukker op.
        </p>
      );
    case "failed":
      return (
        <div className="stack">
          <p className="empty">Opsummeringen kunne ikke laves efter flere forsøg.</p>
          {retry}
        </div>
      );
    case "ready":
      break;
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
