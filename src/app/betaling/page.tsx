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
import { currentAndNextPeriod, formatCalendarDate, lastDayOf } from "@/server/charges/periods";
import { getMyMembership, getMyQuizFrequency } from "@/server/memberships";
import {
  createMembership,
  registerCard,
  setMembershipFrequency,
} from "@/server/memberships/actions";
import { getActivePricingRule } from "@/server/pricing";
import { computeMeetingFee, formatMinor } from "@/server/pricing/algorithm";

export const metadata: Metadata = {
  title: "Betaling — Advisory Board Unlimited",
};
export const dynamic = "force-dynamic";

const CHARGE_LABEL: Record<PaymentCharge["status"], string> = {
  afventer: "Afventer — prisen er endnu ikke meldt til betalingsleverandøren",
  rapporteret: "Meldt til betalingsleverandøren — afregnes på næste faktura",
  gennemfoert: "Betalt",
  fejlet: "Betaling fejlede",
};

/** Perioden som "4. november – 1. december 2026" (til og med). Gamle pr.-møde-rækker har ingen periode. */
function describePeriod(charge: PaymentCharge): string {
  if (!charge.periodStart || !charge.periodEnd) return "Pr. møde (tidligere model)";
  return `${formatCalendarDate(charge.periodStart)} – ${formatCalendarDate(
    lastDayOf({ start: charge.periodStart, end: charge.periodEnd }),
  )}`;
}

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
  const schedule = membership?.billingAnchor
    ? currentAndNextPeriod(membership.billingAnchor, membership.cancelledAt)
    : null;
  // Samme formel og samme regel som den planlagte kørsel regner med — kun vist, aldrig gemt her.
  const periodAmount = rule && partnerCount >= 1 ? computeMeetingFee(rule, partnerCount, frequency) : null;

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/dashboard">Dashboard</Link> · Abonnement
          </>
        }
        title="Dit abonnement"
        lead="Du betaler et fast abonnement der forfalder hver fjerde uge — uanset hvor mange møder der afholdes i perioden. Beløbets størrelse afhænger af hvor mange rådgivere der sidder på dit board, og hvor ofte I mødes. Ændrer du board eller frekvens, gælder den nye pris fra næste periode."
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
                <>
                  <PriceBreakdown
                    rule={rule}
                    partnerCount={partnerCount}
                    frequencyWeeks={frequency}
                  />
                  <p className="body">
                    Prisen opkræves hver fjerde uge og beregnes ud fra de {partnerCount} rådgivere på
                    dit board og mødefrekvensen hver {frequency}. uge.
                  </p>
                </>
              ) : (
                <p className="form__notice" role="status">
                  Der er ingen aktiv prisregel endnu — startprisen besluttes af ejerne. Indtil da kan
                  abonnementets beløb ikke beregnes, og der oprettes ingen opkrævninger.
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
                  <table className="table">
                    <tbody>
                      <tr className="table__row">
                        <th className="table__head">Mødefrekvens</th>
                        <td className="table__cell">Hver {membership.frequencyWeeks}. uge</td>
                      </tr>
                      <tr className="table__row">
                        <th className="table__head">Rådgivere på boardet</th>
                        <td className="table__cell">{partnerCount}</td>
                      </tr>
                      <tr className="table__row">
                        <th className="table__head">Abonnement pr. 4. uge</th>
                        <td className="table__cell">
                          {periodAmount
                            ? formatMinor(periodAmount.amountMinor, periodAmount.currency)
                            : "Ikke beregnet — ingen aktiv prisregel"}
                        </td>
                      </tr>
                      <tr className="table__row">
                        <th className="table__head">Betalingskort</th>
                        <td className="table__cell">
                          {membership.cardStatus === "registreret" ? "Registreret" : "Mangler"}
                        </td>
                      </tr>
                      <tr className="table__row">
                        <th className="table__head">Indeværende periode</th>
                        <td className="table__cell">
                          {schedule?.current
                            ? `${formatCalendarDate(schedule.current.start)} – ${formatCalendarDate(
                                lastDayOf(schedule.current),
                              )}`
                            : "Starter når kortet er registreret"}
                        </td>
                      </tr>
                      <tr className="table__row">
                        <th className="table__head">Næste forfaldsdato</th>
                        <td className="table__cell">
                          {!schedule
                            ? "Fastsættes når kortet er registreret"
                            : schedule.next
                              ? formatCalendarDate(schedule.next.start)
                              : "Ingen — abonnementet er opsagt"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <AuthForm action={setMembershipFrequency} submitLabel="Skift frekvens">
                    <input type="hidden" name="membership_id" value={membership.id} />
                    <Select
                      name="frequency_weeks"
                      label="Ny mødefrekvens (gælder fra næste periode)"
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
                <p className="body">
                  Ingen opkrævninger endnu — den første oprettes når dit kort er registreret og
                  prisen er fastsat. Derefter følger én opkrævning pr. fjerde uge.
                </p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th className="table__head">Periode</th>
                      <th className="table__head">Beløb</th>
                      <th className="table__head">Grundlag</th>
                      <th className="table__head">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charges.map((charge) => (
                      <tr key={charge.id} className="table__row">
                        <td className="table__cell">{describePeriod(charge)}</td>
                        <td className="table__cell">
                          {formatMinor(charge.amountMinor, charge.currency)}
                        </td>
                        <td className="table__cell">
                          {charge.partnerCount && charge.frequencyWeeks
                            ? `${charge.partnerCount} rådgivere · hver ${charge.frequencyWeeks}. uge`
                            : "—"}
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
