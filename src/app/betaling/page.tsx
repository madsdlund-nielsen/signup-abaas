import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";
import { PriceBreakdown } from "@/components/PriceBreakdown";
import { Select } from "@/components/Select";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { getCurrentUser } from "@/server/auth";
import { getMyBoard } from "@/server/boards";
import { listMyCharges, type PaymentCharge } from "@/server/charges";
import { getMyMembership, getMyQuizFrequency } from "@/server/memberships";
import {
  createMembership,
  registerCard,
  setMembershipFrequency,
} from "@/server/memberships/actions";
import { getActivePricingRule } from "@/server/pricing";
import { formatMinor } from "@/server/pricing/algorithm";

export const metadata: Metadata = {
  title: "Betaling — Advisory Board Unlimited",
};
export const dynamic = "force-dynamic";

const CHARGE_LABEL: Record<PaymentCharge["status"], string> = {
  afventer: "Afventer indberetning",
  rapporteret: "Indberettet — afregnes på næste faktura",
  gennemfoert: "Gennemført",
  fejlet: "Fejlet",
};

const FREQUENCIES = [4, 8, 12] as const;

export default async function PaymentPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.roles.includes("ejer")) redirect("/dashboard");

  const [board, membership, rule, charges, quizFrequency] = await Promise.all([
    getMyBoard(),
    getMyMembership(),
    getActivePricingRule(),
    listMyCharges(),
    getMyQuizFrequency(),
  ]);

  const frequency = membership?.frequencyWeeks ?? quizFrequency ?? 4;
  const partnerCount = board?.members.length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/dashboard">Dashboard</Link> · Abonnement
          </>
        }
        title="Dit abonnement"
        lead="Du betaler et fast abonnement der forfalder hver fjerde uge. Beløbets størrelse afhænger af hvor mange rådgivere der sidder på dit board, og hvor ofte I mødes. Ændrer du board eller frekvens, gælder den nye pris fra næste opkrævning."
      />
      <PageBody>
        {!board ? (
          <p className="body">
            Du skal godkende dit board først.{" "}
            <Link className="btn-secondary" href="/board">
              Se dit anbefalede board
            </Link>
          </p>
        ) : (
          <>
            <section className="stack measure">
              <h2 className="heading-3 heading--on-light">Din pris</h2>
              {rule ? (
                <PriceBreakdown
                  rule={rule}
                  partnerCount={partnerCount}
                  frequencyWeeks={frequency}
                />
              ) : (
                <p className="form__notice" role="status">
                  Prisen er ikke fastsat endnu — startprisen besluttes af ejerne, og indtil da kan
                  der ikke beregnes et meeting-fee eller oprettes opkrævninger.
                </p>
              )}
            </section>

            <section className="stack measure">
              <h2 className="heading-3 heading--on-light">Dit medlemskab</h2>
              {!membership ? (
                <AuthForm action={createMembership} submitLabel="Opret medlemskab">
                  <input type="hidden" name="board_id" value={board.id} />
                  <Select
                    name="frequency_weeks"
                    label="Mødefrekvens"
                    defaultValue={String(frequency)}
                  >
                    {FREQUENCIES.map((weeks) => (
                      <option key={weeks} value={weeks}>
                        Hver {weeks}. uge
                      </option>
                    ))}
                  </Select>
                </AuthForm>
              ) : (
                <>
                  <p className="body">
                    Frekvens: hver {membership.frequencyWeeks}. uge · Kort:{" "}
                    {membership.cardStatus === "registreret" ? "registreret" : "mangler"}
                  </p>
                  <AuthForm action={setMembershipFrequency} submitLabel="Skift frekvens">
                    <input type="hidden" name="membership_id" value={membership.id} />
                    <Select
                      name="frequency_weeks"
                      label="Ny mødefrekvens (gælder fra næste afholdte møde)"
                      defaultValue={String(membership.frequencyWeeks)}
                    >
                      {FREQUENCIES.map((weeks) => (
                        <option key={weeks} value={weeks}>
                          Hver {weeks}. uge
                        </option>
                      ))}
                    </Select>
                  </AuthForm>
                  {membership.cardStatus !== "registreret" ? (
                    <AuthForm action={registerCard} submitLabel="Registrér betalingskort">
                      <input type="hidden" name="membership_id" value={membership.id} />
                    </AuthForm>
                  ) : null}
                </>
              )}
            </section>

            <section className="stack">
              <h2 className="heading-3 heading--on-light">Dine opkrævninger</h2>
              {charges.length === 0 ? (
                <p className="body">Ingen opkrævninger endnu — de oprettes når et møde afholdes.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th className="table__head">Oprettet</th>
                      <th className="table__head">Beløb</th>
                      <th className="table__head">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charges.map((charge) => (
                      <tr key={charge.id} className="table__row">
                        <td className="table__cell">
                          {new Date(charge.createdAt).toLocaleDateString("da-DK", {
                            dateStyle: "long",
                          })}
                        </td>
                        <td className="table__cell">
                          {formatMinor(charge.amountMinor, charge.currency)}
                        </td>
                        <td className="table__cell">
                          {CHARGE_LABEL[charge.status]}
                          {charge.failureReason ? ` — ${charge.failureReason}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </PageBody>
    </>
  );
}
