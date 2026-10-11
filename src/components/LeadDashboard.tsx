import Link from "next/link";

import { Figure } from "@/components/Dashboard";
import type { BoardCoverage } from "@/server/dashboard/coverage";
import { formatMeetingStart, type DashboardMeeting } from "@/server/dashboard/meetings";

/**
 * Lead-partnerens dashboard (fase 5.4, ADR 0055): kompetenceoverblik for boardet og ansvaret for
 * næste møde (spec V5). Ren præsentation — dækningen er regnet i `computeBoardCoverage`.
 *
 * Hvem der ER lead afgøres af data på boardet; reglerne for tildeling er uafklarede, og
 * markeringen ligger stadig bag flaget `leadPartner` i UI'et andetsteds. Dashboardet viser
 * uanset hvad der står i data.
 * TODO(ejer): lead-partner — tildelings- og rotationsregler (byggespec §12 pkt. 15).
 */

const UNKNOWN_TAG = "Ukendt kompetence";

/** Kompetenceoverblikket: behov vs. dækning, og hvem der dækker hvad. */
export function CoverageOverview({
  coverage,
  tagLabels,
}: {
  /** `null` = behovene kunne ikke læses (ikke det samme som "ingen behov"). */
  coverage: BoardCoverage | null;
  tagLabels: Record<string, string>;
}) {
  if (coverage === null) {
    return (
      <p className="empty">
        Ejerens kompetencebehov kunne ikke læses lige nu, så overblikket vises ikke — hellere ingen
        tal end forkerte.
      </p>
    );
  }
  if (coverage.needs.length === 0) {
    return (
      <p className="empty">
        Ejeren har ikke angivet kompetencebehov endnu (quizzen er ikke besvaret), så der er intet at
        måle boardets dækning mod.
      </p>
    );
  }

  return (
    <div className="stack">
      <div className="figures">
        <Figure label="Ejerens behov" value={coverage.needs.length} note="Kompetencer fra quizzen" />
        <Figure
          label="Dækket af boardet"
          value={coverage.coveredTagIds.length}
          note={`af ${coverage.needs.length}`}
        />
        <Figure
          label="Udækket"
          value={coverage.uncoveredTagIds.length}
          note={coverage.uncoveredTagIds.length === 0 ? "Alle behov er dækket" : "Ingen på boardet dækker dem"}
        />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="table__head">Behov</th>
              <th className="table__head">Dækket af</th>
            </tr>
          </thead>
          <tbody>
            {coverage.needs.map((need) => (
              <tr key={need.tagId} className="table__row">
                <td className="table__cell">{tagLabels[need.tagId] ?? UNKNOWN_TAG}</td>
                <td className="table__cell">
                  {need.coveredBy.length > 0
                    ? need.coveredBy.map((member) => member.name).join(", ")
                    : "Udækket"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Ansvaret for næste møde: fremhævet, når der intet er aftalt. */
export function NextMeetingResponsibility({ next }: { next: DashboardMeeting | null }) {
  if (next) {
    return (
      <div className="panel">
        <p className="eyebrow">Næste møde</p>
        <h3 className="heading-3 heading--on-light">{formatMeetingStart(next.startsAt)}</h3>
        <p className="body">Mødet er aftalt. Som lead sørger du for at boardet er forberedt.</p>
        <p>
          <Link className="btn-secondary" href={`/moeder/${next.id}`}>
            Åbn mødet
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="stack">
      <p className="form__notice" role="status">
        Der er ikke aftalt et næste møde. Som lead-partner har du ansvar for at få det aftalt.
      </p>
      <p>
        <Link className="btn-primary" href="/partner">
          Initiér næste møde
        </Link>
      </p>
    </div>
  );
}

export function LeadDashboard({
  boardName,
  coverage,
  tagLabels,
  next,
}: {
  boardName: string;
  coverage: BoardCoverage | null;
  tagLabels: Record<string, string>;
  next: DashboardMeeting | null;
}) {
  return (
    <div className="stack">
      <p className="factline">
        <span>{boardName}</span>
        <span>Du er lead på dette board</span>
      </p>
      <NextMeetingResponsibility next={next} />
      <CoverageOverview coverage={coverage} tagLabels={tagLabels} />
    </div>
  );
}
