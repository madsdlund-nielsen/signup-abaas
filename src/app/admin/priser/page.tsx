import Link from "next/link";
import type { Metadata } from "next";

import { listPricingRules } from "@/server/pricing";
import { activatePricingRule, createPricingRule } from "@/server/pricing/actions";
import { formatMinor } from "@/server/pricing/algorithm";
import { PricingRuleForm } from "@/components/PricingRuleForm";

export const metadata: Metadata = { title: "Prisregler — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPricingPage() {
  const rules = await listPricingRules();
  const nextVersion = (rules[0]?.version ?? 0) + 1;
  const active = rules.find((rule) => rule.isActive);

  return (
    <main className="container stack">
      <p className="eyebrow">
        <Link href="/admin">Admin</Link> · Prisregler
      </p>
      <h1 className="heading-2 heading--on-light">Prisregler</h1>
      <p className="body">
        Meeting-fee beregnes som (grundpris + antal partnere × pris pr. partner) × frekvensfaktor.
        Versioner er uforanderlige: opret en ny version og aktivér den — hver opkrævning refererer
        den version der blev anvendt. Beløb angives i øre.
      </p>
      {!active ? (
        <p className="form__notice" role="status">
          Ingen aktiv prisregel — prisberegning og opkrævningsgrundlag er slået fra, indtil en
          version aktiveres. Startprisen fastsættes af ejerne.
        </p>
      ) : null}

      <section className="stack">
        <h2 className="heading-3 heading--on-light">Ny version</h2>
        <PricingRuleForm action={createPricingRule} nextVersion={nextVersion} />
      </section>

      {rules.length > 0 ? (
        <section className="stack">
          <h2 className="heading-3 heading--on-light">Versioner</h2>
          <table className="table">
            <thead>
              <tr>
                <th className="table__head">Version</th>
                <th className="table__head">Grundpris</th>
                <th className="table__head">Pr. partner</th>
                <th className="table__head">Faktor 4/8/12</th>
                <th className="table__head">Status</th>
                <th className="table__head">Handling</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="table__row">
                  <td className="table__cell">{rule.version}</td>
                  <td className="table__cell">{formatMinor(rule.baseAmountMinor, rule.currency)}</td>
                  <td className="table__cell">
                    {formatMinor(rule.perPartnerAmountMinor, rule.currency)}
                  </td>
                  <td className="table__cell">
                    {rule.factor4Weeks} / {rule.factor8Weeks} / {rule.factor12Weeks}
                  </td>
                  <td className="table__cell">{rule.isActive ? "Aktiv" : "—"}</td>
                  <td className="table__cell">
                    {!rule.isActive ? (
                      <form action={activatePricingRule}>
                        <input type="hidden" name="id" value={rule.id} />
                        <button className="btn-secondary" type="submit">
                          Aktivér
                        </button>
                      </form>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </main>
  );
}
