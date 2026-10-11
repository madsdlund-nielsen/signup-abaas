import Link from "next/link";
import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";
import { FeeFigures, FeeLinesTable, FeeNotices, PeriodNav } from "@/components/FeeStatement";
import { Field } from "@/components/Field";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { Select } from "@/components/Select";
import {
  ABSENCE_RULE_LABEL,
  VAT_MODE_LABEL,
  groupByPartner,
  listFeeLines,
  listFeeRules,
  resolvePeriod,
  summarizeFees,
} from "@/server/fees";
import { createFeeRule } from "@/server/fees/actions";
import { listPartners } from "@/server/partners";
import { formatMinor } from "@/server/pricing/algorithm";

export const metadata: Metadata = { title: "Honorar — Admin" };
export const dynamic = "force-dynamic";

function formatFrom(iso: string): string {
  return new Date(iso).toLocaleString("da-DK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Copenhagen",
  });
}

/**
 * Admin: honorarregler og opgørelse (fase 5.1/5.2, skærm-først — ADR 0042/0051). Rolle-guarden
 * ligger i /admin/layout.tsx; RLS er andet lag (viewen giver kun admin andres rækker).
 *
 * Eksporten er en ren grænseflade (CSV). Der er ingen bogføringsintegration: e-conomic vs.
 * Dinero er uafklaret, og `src/lib/accounting/` forbliver på stub.
 *
 * TODO(ejer): honorarsats (§12 pkt. 1), moms (§12 pkt. 14), honorar ved udeblivelse (§12 pkt. 13),
 *   regnskabssystem (e-conomic/Dinero), og om udbetaling skal automatiseres.
 */
export default async function AdminFeesPage({
  searchParams,
}: {
  searchParams: Promise<{ maaned?: string; partner?: string }>;
}) {
  const { maaned, partner } = await searchParams;
  const period = resolvePeriod(maaned);
  const partnerId = partner || undefined;

  const [rules, partners, lines] = await Promise.all([
    listFeeRules(),
    listPartners(),
    listFeeLines({ from: period.from, to: period.to, partnerId }),
  ]);
  const totals = summarizeFees(lines.map((line) => line.result));
  const groups = groupByPartner(lines);
  const extra: Record<string, string> = partnerId ? { partner: partnerId } : {};
  const exportQuery = new URLSearchParams({ ...extra, maaned: period.month }).toString();

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/admin">Admin</Link> · Honorar
          </>
        }
        title="Honorar"
        lead="Honorarregler er versioneret og uforanderlige: en ny version gælder fra sit gyldighedstidspunkt, og et møde afregnes altid efter den regel der gjaldt da det blev afholdt. Satser angives i øre pr. time."
      />
      <PageBody>
        {rules.length === 0 ? (
          <p className="form__notice" role="status">
            Ingen honorarregel er oprettet — partnerne ser &quot;Honorarsatsen er ikke fastlagt
            endnu&quot;, og ingen linje får et beløb. Satsen fastsættes af ejerne.
          </p>
        ) : null}

        <section className="stack measure">
          <h2 className="heading-3 heading--on-light">Ny version</h2>
          <p className="body">
            Grundlaget pr. møde er mødet plus betalt forberedelse (75 min). Moms og afbudsregel kan
            stå som &quot;ikke fastlagt&quot; — så registreres grundlaget, men konsekvensen
            beregnes ikke.
          </p>
          <AuthForm action={createFeeRule} submitLabel={`Gem som version ${(rules[0]?.version ?? 0) + 1}`}>
            <Field
              name="hourly_rate_minor"
              label="Honorarsats pr. time (øre)"
              type="number"
              min={0}
              step={1}
              required
            />
            <Select name="vat_mode" label="Moms på honorar" defaultValue="ikke_fastlagt">
              {Object.entries(VAT_MODE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select name="absence_rule" label="Honorar ved forsinket afbud / udeblivelse" defaultValue="ikke_fastlagt">
              {Object.entries(ABSENCE_RULE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Field name="effective_from" label="Gælder fra (dansk tid)" type="datetime-local" required />
          </AuthForm>
        </section>

        {rules.length > 0 ? (
          <section className="stack">
            <h2 className="heading-3 heading--on-light">Versioner</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="table__head">Version</th>
                    <th className="table__head table__head--num">Sats pr. time</th>
                    <th className="table__head">Moms</th>
                    <th className="table__head">Afbud / udeblivelse</th>
                    <th className="table__head">Gælder fra</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} className="table__row">
                      <td className="table__cell">{rule.version}</td>
                      <td className="table__cell table__cell--num">
                        {formatMinor(rule.hourlyRateMinor, rule.currency)}
                      </td>
                      <td className="table__cell">{VAT_MODE_LABEL[rule.vatMode]}</td>
                      <td className="table__cell">{ABSENCE_RULE_LABEL[rule.absenceRule]}</td>
                      <td className="table__cell">{formatFrom(rule.effectiveFrom)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="stack">
          <h2 className="heading-3 heading--on-light">Opgørelse</h2>
          <PeriodNav month={period.month} basePath="/admin/honorar" extra={extra} />
          <form className="row-form" method="get" action="/admin/honorar">
            <input type="hidden" name="maaned" value={period.month} />
            <Select name="partner" label="Partner" defaultValue={partnerId ?? ""}>
              <option value="">Alle partnere</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <button className="btn-secondary" type="submit">
              Vis
            </button>
          </form>

          <FeeFigures totals={totals} />
          <FeeNotices totals={totals} hasRules={rules.length > 0} />

          {groups.length === 0 ? <p className="empty">Ingen møder i perioden.</p> : null}
          {groups.map((group) => {
            const groupTotals = summarizeFees(group.lines.map((line) => line.result));
            return (
              <div key={group.partnerProfileId} className="stack">
                <h3 className="heading-3 heading--on-light">{group.partnerName}</h3>
                <FeeLinesTable lines={group.lines} totals={groupTotals} />
              </div>
            );
          })}

          <div className="row-form">
            <a className="btn-secondary" href={`/admin/honorar/eksport?${exportQuery}`}>
              Eksportér som CSV
            </a>
          </div>
          <p className="body">
            Eksporten er en ren fil — der er ingen forbindelse til et regnskabssystem
            (e-conomic eller Dinero er ikke valgt), og udbetaling er ikke automatiseret.
          </p>
        </section>
      </PageBody>
    </>
  );
}
