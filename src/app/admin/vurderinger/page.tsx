import Link from "next/link";
import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/PageHeader";

import { listPartnerRatingSummary } from "@/server/ratings";

export const metadata: Metadata = { title: "Vurderinger — Admin" };
export const dynamic = "force-dynamic";

/**
 * Admin-visning af mødevurderinger pr. partner (fase 4.2). Rolle-guarden ligger i
 * /admin/layout.tsx; RLS (0015) er andet lag — en ikke-admin ville få et tomt resultat,
 * ikke andres data.
 *
 * Visningen er bevidst passiv: tal, ingen handlinger. Hvad ratings skal føre til —
 * matching-tie-break, udskiftning af en rådgiver — er ikke besluttet, og en knap her
 * ville foregribe den beslutning.
 */
export default async function AdminRatingsPage() {
  const summary = await listPartnerRatingSummary();
  const total = summary.reduce((sum, row) => sum + row.count, 0);

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/admin">Admin</Link> · Vurderinger
          </>
        }
        title="Vurderinger pr. rådgiver"
        lead="Gennemsnit af de vurderinger ejere og partnere har afgivet efter afholdte møder. Vurderinger er fortrolige for den enkelte afgiver — kun denne side samler dem."
      />
      <PageBody>
        <p className="form__notice" role="status">
          Tallene er datagrundlag, ikke en offentlig score. De påvirker ikke board-matchingen: om
          rating skal indgå som tie-break er ikke besluttet endnu.
        </p>

        {summary.length > 0 ? (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th className="table__head">Rådgiver</th>
                  <th className="table__head">Vurderinger</th>
                  <th className="table__head">Gennemsnit</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={row.partnerProfileId} className="table__row">
                    <td className="table__cell">{row.name}</td>
                    <td className="table__cell">{row.count}</td>
                    <td className="table__cell">
                      {row.average === null ? "—" : row.average.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="body">
              {total} vurdering{total === 1 ? "" : "er"} fordelt på {summary.length} rådgiver
              {summary.length === 1 ? "" : "e"}.
            </p>
          </>
        ) : (
          <p className="body">
            Ingen vurderinger endnu. De opstår når et møde er registreret som afholdt og en deltager
            har vurderet det.
          </p>
        )}
      </PageBody>
    </>
  );
}
