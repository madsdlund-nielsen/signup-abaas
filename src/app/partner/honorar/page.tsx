import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { FeeFigures, FeeLinesTable, FeeNotices, PeriodNav } from "@/components/FeeStatement";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { getCurrentUser } from "@/server/auth";
import { listFeeRules, listMyFeeLines, resolvePeriod, summarizeFees } from "@/server/fees";
import { getMyPartnerProfile } from "@/server/partners/portal";

export const metadata: Metadata = { title: "Honorar — Partner" };
export const dynamic = "force-dynamic";

/**
 * Partnerens egen honoraropgørelse (fase 5.1, bygget skærm-først — ADR 0042/0051). Tal først:
 * sum, antal afholdte møder og hvad der endnu ikke kan regnes — derefter linjerne.
 *
 * Læsevejen er viewen `partner_fee_line` (0017), som kun giver partneren egne rækker; en
 * medpartners honorar kan ikke nå siden, selv om mødet deles.
 *
 * TODO(ejer): honorarsats, moms og honorar ved udeblivelse er uafklarede — siden siger det
 * højt frem for at gætte. Udbetaling er ikke automatiseret (docs/fase-5.md §5.2).
 */
export default async function PartnerFeesPage({
  searchParams,
}: {
  searchParams: Promise<{ maaned?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.roles.includes("partner")) redirect("/dashboard");

  const { maaned } = await searchParams;
  const period = resolvePeriod(maaned);

  const [profile, lines, rules] = await Promise.all([
    getMyPartnerProfile(),
    listMyFeeLines(period),
    listFeeRules(),
  ]);
  const totals = summarizeFees(lines.map((line) => line.result));

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/partner">Partner</Link> · Honorar
          </>
        }
        title="Dit honorar"
        lead="Opgørelse pr. måned over de møder du har deltaget i. Grundlaget er mødet plus betalt forberedelse; satsen fastsættes af administratoren."
      />
      <PageBody>
        {!profile ? (
          <p className="form__notice" role="status">
            Din bruger er endnu ikke koblet til en katalogprofil, så der er ingen opgørelse at vise.
            Kontakt administratoren.
          </p>
        ) : (
          <>
            <PeriodNav month={period.month} basePath="/partner/honorar" />
            <FeeFigures totals={totals} />
            <FeeNotices totals={totals} hasRules={rules.length > 0} />
            <section className="stack">
              <h2 className="heading-3 heading--on-light">Linjer</h2>
              <FeeLinesTable lines={lines} linkMeetings totals={totals} />
            </section>
            <p className="body">
              Udbetaling sker ikke automatisk endnu — opgørelsen er grundlaget, ikke en betaling.
            </p>
          </>
        )}
        <p className="body">
          <Link href="/partner">Til partnerportalen</Link>
        </p>
      </PageBody>
    </>
  );
}
