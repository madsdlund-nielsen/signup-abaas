import Link from "next/link";
import type { ReactNode } from "react";

import { FeeFigures, FeeNotices, formatFeeSum } from "@/components/FeeStatement";
import { Stat } from "@/components/OpsOverview";
import type { OpsOverview } from "@/server/admin";
import type { OwnerBoard } from "@/server/boards";
import type { MonthFees } from "@/server/dashboard";
import {
  formatMeetingStart,
  formatMeetingStartShort,
  participantNames,
  type DashboardMeeting,
} from "@/server/dashboard/meetings";
import { formatMonth } from "@/server/fees/period";
import type { Membership } from "@/server/memberships";

/**
 * Rolle-dashboardenes byggeklodser (fase 5.4, ADR 0055). Rene props-komponenter: hvad der
 * hentes og for hvem afgøres på siden (`/dashboard`) af RLS-scopede læsninger; her er kun
 * præsentation. Tal først (`.figures`/`.stats`), derefter detaljen — tynde overskrifter,
 * versal-etiketter, ingen nye farver. En tom tilstand guider altid videre til næste handling.
 */

/** Én rolles sektion. Søskende-sektioner adskilles af en tynd regel (`.dash-section + …`). */
export function DashboardSection({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="dash-section stack">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="heading-3 heading--on-light">{title}</h2>
      {lead ? <p className="body measure">{lead}</p> : null}
      {children}
    </section>
  );
}

/** Indgangslinks til rollens underflader — dashboardet viser tal, siderne bærer handlingerne. */
export function SectionLinks({ links }: { links: ReadonlyArray<{ href: string; label: string }> }) {
  return (
    <p className="row-form">
      {links.map((link) => (
        <Link key={link.href} className="btn-secondary" href={link.href}>
          {link.label}
        </Link>
      ))}
    </p>
  );
}

/** Ét nøgletal i `.figures`-gitteret. */
export function Figure({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div>
      <p className="figure__label">{label}</p>
      <p className="figure__value">{value}</p>
      {note ? <p className="figure__note">{note}</p> : null}
    </div>
  );
}

/** Næste møde: dato/tid på dansk, deltagere og vejen til forberedelse og selve mødet. */
export function NextMeetingPanel({
  meeting,
  empty,
}: {
  meeting: DashboardMeeting | null;
  /** Hvad panelet siger, når der ikke er et kommende møde — gerne med vejen til at få et. */
  empty?: ReactNode;
}) {
  if (!meeting) {
    return (
      <div className="panel">
        <p className="eyebrow">Næste møde</p>
        <p className="body">{empty ?? "Der er ikke aftalt et kommende møde."}</p>
      </div>
    );
  }
  return (
    <div className="panel">
      <p className="eyebrow">Næste møde</p>
      <h3 className="heading-3 heading--on-light">{formatMeetingStart(meeting.startsAt)}</h3>
      <p className="body">Med {participantNames(meeting)}</p>
      <p className="row-form">
        <Link className="btn-secondary" href={`/moeder/${meeting.id}`}>
          Forberedelse
        </Link>
        {meeting.videoJoinUrl ? (
          <a className="btn-primary" href={meeting.videoJoinUrl}>
            Deltag
          </a>
        ) : null}
      </p>
    </div>
  );
}

/** Kommende møder efter det næste — højst `limit`; resten bor under "Alle møder". */
export function UpcomingMeetingsTable({
  meetings,
  total,
  allHref,
}: {
  /** De møder der vises (kalderen har allerede afkortet og udeladt det næste). */
  meetings: DashboardMeeting[];
  /** Antal kommende møder i alt, så "Alle møder" kan sige hvor mange der er. */
  total: number;
  allHref: string;
}) {
  if (meetings.length === 0) return null;
  return (
    <div className="stack">
      <p className="eyebrow">Herefter</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="table__head">Tidspunkt</th>
              <th className="table__head">Deltagere</th>
            </tr>
          </thead>
          <tbody>
            {meetings.map((meeting) => (
              <tr key={meeting.id} className="table__row">
                <td className="table__cell">
                  <Link href={`/moeder/${meeting.id}`}>{formatMeetingStartShort(meeting.startsAt)}</Link>
                </td>
                <td className="table__cell">{participantNames(meeting)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="body">
        <Link href={allHref}>Alle møder ({total} kommende)</Link>
      </p>
    </div>
  );
}

/** Boardets sammensætning: navne, lead markeret, vej til `/board`. */
export function BoardPanel({ board, href }: { board: OwnerBoard; href: string }) {
  return (
    <div className="panel">
      <p className="eyebrow">Dit board</p>
      <h3 className="heading-3 heading--on-light">{board.name}</h3>
      {board.members.length === 0 ? (
        <p className="body">Boardet har ingen rådgivere endnu.</p>
      ) : (
        <ul className="partner-card__tags">
          {board.members.map((member) => (
            <li key={member.partnerId} className={member.isLead ? "partner-tag partner-tag--match" : "partner-tag"}>
              {member.name}
              {member.isLead ? " · Lead" : ""}
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link className="btn-secondary" href={href}>
          Se board
        </Link>
      </p>
    </div>
  );
}

/** Abonnementets tilstand — kun medlemskabets egen status, ikke trækhistorik (den bor på /betaling). */
export function PaymentPanel({ membership }: { membership: Membership | null }) {
  if (!membership) {
    return (
      <div className="panel">
        <p className="eyebrow">Abonnement</p>
        <p className="body">Du har ikke oprettet et abonnement endnu.</p>
        <p>
          <Link className="btn-secondary" href="/betaling">
            Opret abonnement
          </Link>
        </p>
      </div>
    );
  }
  const cardMissing = membership.cardStatus === "mangler";
  return (
    <div className="panel">
      <p className="eyebrow">Abonnement</p>
      <h3 className="heading-3 heading--on-light">
        {membership.status === "aktiv" ? "Aktivt" : "Opsagt"}
      </h3>
      <p className="body">
        Betalingskort: {cardMissing ? "mangler" : "registreret"} · Møde hver{" "}
        {membership.frequencyWeeks}. uge
      </p>
      {cardMissing && membership.status === "aktiv" ? (
        <p className="form__notice" role="status">
          Der er endnu ikke registreret et betalingskort. Uden kort kan abonnementet ikke opkræves.
        </p>
      ) : null}
      <p>
        {cardMissing && membership.status === "aktiv" ? (
          <Link className="btn-primary" href="/betaling">
            Registrér kort
          </Link>
        ) : (
          <Link className="btn-secondary" href="/betaling">
            Se abonnement
          </Link>
        )}
      </p>
    </div>
  );
}

/** Ejerens dashboard. Intet board → onboarding er den eneste fornuftige næste handling. */
export function OwnerDashboard({
  board,
  membership,
  upcoming,
}: {
  board: OwnerBoard | null;
  membership: Membership | null;
  /** Kommende møder på ejerens board, tidligst først. */
  upcoming: DashboardMeeting[];
}) {
  if (!board) {
    return (
      <div className="stack">
        <p className="empty">
          Du har endnu ikke et board. Besvar quizzen, så sammensætter vi de rådgivere der dækker det
          du har brug for.
        </p>
        <p>
          <Link className="btn-primary" href="/onboarding">
            Start onboarding
          </Link>
        </p>
      </div>
    );
  }

  const lead = board.members.find((member) => member.isLead);
  const [next, ...rest] = upcoming;

  return (
    <div className="stack">
      <div className="figures">
        <Figure
          label="Kommende møder"
          value={upcoming.length}
          note={next ? `Næste: ${formatMeetingStartShort(next.startsAt)}` : "Intet aftalt endnu"}
        />
        <Figure
          label="Rådgivere"
          value={board.members.length}
          note={lead ? `Lead: ${lead.name}` : "Ingen lead markeret"}
        />
        <Figure
          label="Mødefrekvens"
          value={membership ? `${membership.frequencyWeeks} uger` : "—"}
          note={membership ? "Mellem møderne" : "Vælges ved abonnementet"}
        />
      </div>
      <div className="panel-grid">
        <NextMeetingPanel
          meeting={next ?? null}
          empty={
            <>
              Du har ingen kommende møder. <Link href="/moeder">Book det næste møde</Link>, så dine
              rådgivere kan forberede sig.
            </>
          }
        />
        <BoardPanel board={board} href="/board" />
        <PaymentPanel membership={membership} />
      </div>
      <UpcomingMeetingsTable meetings={rest.slice(0, 3)} total={upcoming.length} allHref="/moeder" />
    </div>
  );
}

/** Hvor mange faste tider partneren har angivet (til dashboardet — ikke selve ugen). */
export interface AvailabilitySummary {
  slotCount: number;
  /** Fravær der endnu ikke er slut. */
  upcomingAbsenceCount: number;
}

/**
 * Partnerens vurderinger vises IKKE: RLS giver kun den der afgav en vurdering (og admin) adgang
 * til `meeting_rating` (0015), og den vurderede partner ser bevidst ikke sin egen score, før
 * ejeren har besluttet hvad vurderinger skal bruges til. Panelet siger det højt frem for at
 * vise et tal — og vi bygger ingen ny læsevej uden en ADR.
 * TODO(ejer): må en partner se sine egne vurderinger (gennemsnit/antal)? Det er et forretnings-/
 * privatlivsvalg; svaret låser op for en læsevej (view med egen-række-filter, som `partner_fee_line`).
 */
export function RatingsPanel() {
  return (
    <div className="panel">
      <p className="eyebrow">Dine vurderinger</p>
      <p className="body">
        Dine vurderinger vises ikke endnu. Hvad vurderinger skal bruges til — og om du selv skal
        kunne se dem — er ikke besluttet. Vurderingerne indsamles, og administratoren kan se dem.
      </p>
    </div>
  );
}

export function AvailabilityPanel({ summary }: { summary: AvailabilitySummary }) {
  const specified = summary.slotCount > 0;
  return (
    <div className="panel">
      <p className="eyebrow">Din tilgængelighed</p>
      <h3 className="heading-3 heading--on-light">{specified ? "Angivet" : "Ikke angivet"}</h3>
      <p className="body">
        {specified
          ? `${summary.slotCount} ${summary.slotCount === 1 ? "fast tid" : "faste tider"} om ugen`
          : "Du har ikke angivet faste tider, så du kan bookes på alle tidspunkter."}
        {summary.upcomingAbsenceCount > 0
          ? ` · ${summary.upcomingAbsenceCount} ${summary.upcomingAbsenceCount === 1 ? "fraværsperiode" : "fraværsperioder"} på vej`
          : ""}
      </p>
      <p>
        <Link className="btn-secondary" href="/partner/tilgaengelighed">
          {specified ? "Redigér tilgængelighed" : "Angiv tilgængelighed"}
        </Link>
      </p>
    </div>
  );
}

/** Partnerens dashboard: møder, honorar for måneden, vurderinger (hul) og tilgængelighed. */
export function PartnerDashboard({
  linked,
  upcoming,
  fees,
  availability,
}: {
  /** Er brugeren koblet til en katalogprofil? Uden den er der intet at vise. */
  linked: boolean;
  upcoming: DashboardMeeting[];
  fees: MonthFees | null;
  availability: AvailabilitySummary | null;
}) {
  if (!linked) {
    return (
      <p className="form__notice" role="status">
        Din bruger er endnu ikke koblet til en katalogprofil, så der er ingen møder eller honorar at
        vise. Kontakt administratoren.
      </p>
    );
  }
  const [next, ...rest] = upcoming;

  return (
    <div className="stack">
      {fees ? (
        <div className="stack">
          <p className="factline">
            <span>Honorar · {formatMonth(fees.month)}</span>
          </p>
          <FeeFigures totals={fees.totals} />
          <FeeNotices totals={fees.totals} hasRules={fees.hasRules} />
          <p>
            <Link className="btn-secondary" href="/partner/honorar">
              Se din opgørelse
            </Link>
          </p>
        </div>
      ) : null}
      <div className="panel-grid">
        <NextMeetingPanel
          meeting={next ?? null}
          empty="Der er ikke aftalt et kommende møde på dit board."
        />
        <RatingsPanel />
        {availability ? <AvailabilityPanel summary={availability} /> : null}
      </div>
      <UpcomingMeetingsTable meetings={rest.slice(0, 3)} total={upcoming.length} allHref="/partner" />
    </div>
  );
}

/** Adminens tal-først-resumé; detaljerne bor på /admin/drift og /admin/honorar. */
export function AdminDashboard({ ops }: { ops: OpsOverview | null }) {
  if (!ops) {
    return (
      <p className="empty">
        Driftstallene kan ikke læses i dette miljø (Supabase er ikke konfigureret). Åbn driftsoverblikket
        for integrationsstatus.
      </p>
    );
  }
  const fees = ops.fees;
  const atLeast = ops.truncated;

  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Boards" value={ops.platform?.boards ?? null} atLeast={atLeast} />
        <Stat label="Partnere" value={ops.platform?.partners ?? null} atLeast={atLeast} />
        <Stat label="Aktive abonnementer" value={ops.memberships?.active ?? null} atLeast={atLeast} />
        <Stat label="Kort mangler" value={ops.memberships?.cardMissing ?? null} atLeast={atLeast} />
        <Stat label="Fejlede træk" value={ops.charges?.failed ?? null} atLeast={atLeast} />
        <Stat label="Kommende møder" value={ops.meetings?.upcoming ?? null} atLeast={atLeast} />
      </div>
      <div className="figures">
        <Figure
          label={fees ? `Honorar · ${formatMonth(fees.month)}` : "Honorar"}
          value={fees ? formatFeeSum(fees.totals) : "—"}
          note={
            fees
              ? fees.ruleCount === 0
                ? "Honorarsatsen er ikke fastsat"
                : `${fees.totals.calculatedCount} beregnede linjer`
              : "Kunne ikke læses — se serverlog"
          }
        />
      </div>
      <SectionLinks
        links={[
          { href: "/admin/drift", label: "Driftsoverblik" },
          { href: "/admin/honorar", label: "Honorar" },
          { href: "/admin", label: "Administration" },
        ]}
      />
    </div>
  );
}
