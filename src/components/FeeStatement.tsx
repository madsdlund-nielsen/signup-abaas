import Link from "next/link";

import {
  REGISTERED_STATUS_LABEL,
  VAT_MODE_LABEL,
  describeFee,
  type FeeTotals,
} from "@/server/fees/algorithm";
import type { FeeLine } from "@/server/fees/lines";
import { formatMonth, shiftMonth } from "@/server/fees/period";
import { formatMinor } from "@/server/pricing/algorithm";

/**
 * Honoraropgørelsens byggeklodser (Fase 5.1/5.2, ADR 0051) — DELT mellem partnerens egen
 * opgørelse og admins opgørelse pr. partner, så begge ser præcis samme tal og samme forbehold.
 * Rene props-komponenter: beregningen er sket i `src/server/fees` (samme funktion begge steder).
 *
 * Skærmen lover ikke mere end den kan holde: en linje uden sats, uden registrering eller med
 * en uafklaret afbudsregel viser aldrig et beløb, og en manglende momsregel står som "ikke
 * fastlagt" frem for at blive til en antagelse.
 */

function formatStart(startsAt: string): string {
  return new Date(startsAt).toLocaleString("da-DK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Copenhagen",
  });
}

/** Forrige / valgt måned / næste. `extra` er øvrige query-parametre der skal bevares. */
export function PeriodNav({
  month,
  basePath,
  extra = {},
}: {
  month: string;
  basePath: string;
  extra?: Record<string, string>;
}) {
  const href = (target: string) => {
    const query = new URLSearchParams({ ...extra, maaned: target });
    return `${basePath}?${query.toString()}`;
  };
  return (
    <nav className="pager" aria-label="Vælg måned">
      <Link className="btn-secondary" href={href(shiftMonth(month, -1))}>
        Forrige
      </Link>
      <span className="pager__current">{formatMonth(month)}</span>
      <Link className="btn-secondary" href={href(shiftMonth(month, 1))}>
        Næste
      </Link>
    </nav>
  );
}

/** Summen af de beregnede beløb pr. valuta, eller "—" når intet er beregnet (aldrig "0 kr"). */
export function formatFeeSum(totals: FeeTotals): string {
  return totals.totalsByCurrency.length === 0
    ? "—"
    : totals.totalsByCurrency
        .map(({ currency, amountMinor }) => formatMinor(amountMinor, currency))
        .join(" + ");
}

/** Nøgletallene først: sum, afholdte møder, og hvor meget der endnu ikke kan regnes. */
export function FeeFigures({ totals }: { totals: FeeTotals }) {
  const sum = formatFeeSum(totals);
  const open = totals.awaitingRuleCount + totals.noRateCount + totals.notRegisteredCount;

  return (
    <div className="figures">
      <div>
        <p className="figure__label">Honorar i perioden</p>
        <p className="figure__value">{sum}</p>
        <p className="figure__note">
          {totals.calculatedCount === 0
            ? "Intet beregnet endnu"
            : `${totals.calculatedCount} beregnede linjer`}
        </p>
      </div>
      <div>
        <p className="figure__label">Afholdte møder</p>
        <p className="figure__value">{totals.heldCount}</p>
        <p className="figure__note">Registreret som afholdt</p>
      </div>
      <div>
        <p className="figure__label">Uden beløb</p>
        <p className="figure__value">{open}</p>
        <p className="figure__note">Mangler sats, registrering eller afbudsregel</p>
      </div>
    </div>
  );
}

/**
 * Forbehold under tallene. `hasRules` = findes der overhovedet en honorarregel? Uden den er
 * ingen linje beregnelig, og det siges først og tydeligt.
 */
export function FeeNotices({ totals, hasRules }: { totals: FeeTotals; hasRules: boolean }) {
  return (
    <div className="stack">
      {!hasRules ? (
        <p className="form__notice" role="status">
          Honorarsatsen er ikke fastlagt endnu. Møder og registreringer noteres, men der beregnes
          intet beløb før satsen er fastsat.
        </p>
      ) : totals.noRateCount > 0 ? (
        <p className="form__notice" role="status">
          {totals.noRateCount} linje{totals.noRateCount === 1 ? "" : "r"} ligger før den første
          honorarsats trådte i kraft og har derfor intet beløb.
        </p>
      ) : null}

      {totals.awaitingRuleCount > 0 ? (
        <p className="form__notice" role="status">
          {totals.awaitingRuleCount} registrering{totals.awaitingRuleCount === 1 ? "" : "er"} som
          forsinket afbud eller udeblivelse afventer en regel for honorar ved udeblivelse. Grundlaget
          er registreret, men intet beløb er medregnet.
        </p>
      ) : null}

      {totals.vatModes.length > 0 ? (
        <p className="body">
          Momsbehandling i perioden: {totals.vatModes.map((mode) => VAT_MODE_LABEL[mode]).join(", ")}.
          {totals.vatModes.includes("ikke_fastlagt")
            ? " Beløbene er vist uden momsbehandling."
            : " Der er ikke regnet moms i beløbene — de vises som angivet af reglen."}
        </p>
      ) : null}
    </div>
  );
}

/** Linjetabellen. `showPartner` for admin-opgørelsen; `linkMeetings` kun hvor mødesiden er åben for læseren. */
export function FeeLinesTable({
  lines,
  showPartner = false,
  linkMeetings = false,
  totals,
}: {
  lines: FeeLine[];
  showPartner?: boolean;
  linkMeetings?: boolean;
  /** Vises som totalrække når angivet. */
  totals?: FeeTotals;
}) {
  if (lines.length === 0) {
    return <p className="empty">Ingen møder i perioden.</p>;
  }
  const columns = 5 + (showPartner ? 1 : 0);

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="table__head">Møde</th>
            {showPartner ? <th className="table__head">Partner</th> : null}
            <th className="table__head">Registrering</th>
            <th className="table__head table__head--num">Grundlag</th>
            <th className="table__head table__head--num">Beløb</th>
            <th className="table__head">Status</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const { result } = line;
            return (
              <tr key={`${line.meetingId}-${line.partnerProfileId}`} className="table__row">
                <td className="table__cell">
                  {linkMeetings ? (
                    <Link href={`/moeder/${line.meetingId}`}>{formatStart(line.startsAt)}</Link>
                  ) : (
                    formatStart(line.startsAt)
                  )}
                </td>
                {showPartner ? <td className="table__cell">{line.partnerName}</td> : null}
                <td className="table__cell">
                  {line.registeredStatus ? REGISTERED_STATUS_LABEL[line.registeredStatus] : "—"}
                </td>
                <td className="table__cell table__cell--num">
                  {line.durationMinutes + line.prepMinutes} min
                </td>
                <td className="table__cell table__cell--num">
                  {result.kind === "beregnet" ? formatMinor(result.amountMinor, result.currency) : "—"}
                </td>
                <td className="table__cell">
                  {describeFee(result)}
                  {result.kind === "beregnet" ? ` · v${result.ruleVersion}` : null}
                </td>
              </tr>
            );
          })}
          {totals ? (
            <tr className="table__row table__row--total">
              <td className="table__cell" colSpan={columns - 2}>
                <strong>I alt</strong>
              </td>
              <td className="table__cell table__cell--num">
                <strong>
                  {totals.totalsByCurrency.length === 0
                    ? "—"
                    : totals.totalsByCurrency
                        .map(({ currency, amountMinor }) => formatMinor(amountMinor, currency))
                        .join(" + ")}
                </strong>
              </td>
              <td className="table__cell" />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
