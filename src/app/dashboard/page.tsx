import { redirect } from "next/navigation";
import type { Metadata } from "next";

import {
  AdminDashboard,
  DashboardSection,
  OwnerDashboard,
  PartnerDashboard,
  SectionLinks,
  type AvailabilitySummary,
} from "@/components/Dashboard";
import { LeadDashboard } from "@/components/LeadDashboard";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { getOpsOverview } from "@/server/admin";
import { getCurrentUser } from "@/server/auth";
import { signOutAction } from "@/server/auth/actions";
import { getMyAvailability } from "@/server/availability";
import { copenhagenDateOf } from "@/server/availability/algorithm";
import { getMyBoard } from "@/server/boards";
import {
  computeBoardCoverage,
  getLeadBoardNeeds,
  getMyMonthFees,
  isLeadOnBoard,
  upcomingMeetings,
} from "@/server/dashboard";
import { listMyMeetings } from "@/server/meetings";
import { getMyMembership } from "@/server/memberships";
import { getMyPartnerProfile } from "@/server/partners/portal";
import { listTags } from "@/server/tags";

export const metadata: Metadata = {
  title: "Dashboard — Advisory Board Unlimited",
};

// Afhænger af session/cookies — aldrig statisk prerender.
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  ejer: "Ejer",
  partner: "Partner",
  lead_partner: "Lead-partner",
  admin: "Administrator",
};

/**
 * Rolle-dashboards (fase 5.4, bygget skærm-først — ADR 0042/0055). Hver rolle får sin sektion,
 * og en bruger med flere roller ser flere. Alt hentes via RLS-scopede læsninger; den ene
 * undtagelse er lead-partnerens kompetenceoverblik, som læser ejerens behov via service-role
 * bag et lead-tjek (`getLeadBoardNeeds`, ADR 0055).
 *
 * Betalingsstatus er kun medlemskabets egen status — trækhistorikken bor på /betaling.
 *
 * TODO(ejer): lead-tildeling er uafklaret — sektionen hviler på `board_partner.is_lead` i data.
 * TODO(ejer): partnerens egne vurderinger vises ikke (RLS tillader det ikke) — se RatingsPanel.
 * TODO(mads): PostHog-driftstatus på admin-resuméet (kræver live projektnøgle).
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const roles = user.roles.map((r) => ROLE_LABEL[r] ?? r);
  const isOwner = user.roles.includes("ejer");
  const isPartner = user.roles.includes("partner");
  const isAdmin = user.roles.includes("admin");
  const now = new Date();

  const needsBoard = isOwner || isPartner;
  const [board, meetings, membership, profile, ops] = await Promise.all([
    needsBoard ? getMyBoard() : null,
    needsBoard ? listMyMeetings() : [],
    isOwner ? getMyMembership() : null,
    isPartner ? getMyPartnerProfile() : null,
    isAdmin ? getOpsOverview() : null,
  ]);

  // Afgrænset til boardet: en admin ser via RLS ALLE møder, og må ikke se andres under "mine".
  const upcoming = board ? upcomingMeetings(meetings, now, board.id) : [];

  const isLead = isPartner && isLeadOnBoard(profile?.id, board);
  const [fees, availability, leadNeeds, tags] = await Promise.all([
    isPartner && profile ? getMyMonthFees(now) : null,
    isPartner && profile ? getMyAvailability(profile.id) : null,
    isLead && board ? getLeadBoardNeeds(board.id) : null,
    isLead ? listTags() : [],
  ]);

  const today = copenhagenDateOf(now);
  const availabilitySummary: AvailabilitySummary | null = availability
    ? {
        slotCount: availability.slots.length,
        upcomingAbsenceCount: availability.absences.filter((a) => a.endsOn >= today).length,
      }
    : null;

  const coverage =
    isLead && board && leadNeeds ? computeBoardCoverage(leadNeeds.ownerTagIds, board.members) : null;
  const tagLabels = Object.fromEntries(tags.map((tag) => [tag.id, tag.label]));

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title="Velkommen"
        lead={
          <>
            Du er logget ind som {user.email}
            {roles.length > 0 ? ` · ${roles.join(", ")}` : ""}.
          </>
        }
      />
      <PageBody>
        {user.roles.length === 0 ? (
          <p className="empty">
            Din konto har endnu ingen rolle tildelt, så der er ikke noget at gå til herfra. Roller
            tildeles af en administrator — det er med vilje, så ingen kan give sig selv adgang ved
            at oprette en konto.
          </p>
        ) : null}

        {isOwner ? (
          <DashboardSection
            eyebrow="Ejer"
            title="Dit board og dine møder"
            lead="Hvad der sker næste gang, hvem der sidder i dit board, og hvor dit abonnement står."
          >
            <OwnerDashboard board={board} membership={membership} upcoming={upcoming} />
            <SectionLinks
              links={[
                { href: "/onboarding", label: "Onboarding" },
                { href: "/board", label: "Dit board" },
                { href: "/moeder", label: "Møder" },
                { href: "/betaling", label: "Abonnement" },
              ]}
            />
          </DashboardSection>
        ) : null}

        {isPartner ? (
          <DashboardSection
            eyebrow="Partner"
            title="Dine møder og dit honorar"
            lead="Næste møde, månedens honorar og hvor din tilgængelighed står."
          >
            <PartnerDashboard
              linked={profile != null}
              upcoming={upcoming}
              fees={fees}
              availability={availabilitySummary}
            />
            <SectionLinks
              links={[
                { href: "/partner", label: "Partnerportalen" },
                { href: "/partner/honorar", label: "Honorar" },
                { href: "/partner/tilgaengelighed", label: "Tilgængelighed" },
              ]}
            />
          </DashboardSection>
        ) : null}

        {isLead && board ? (
          <DashboardSection
            eyebrow="Lead-partner"
            title="Boardets kompetencer"
            lead="Hvad ejeren har brug for, hvad dit board dækker — og ansvaret for at næste møde bliver aftalt."
          >
            <LeadDashboard
              boardName={board.name}
              coverage={coverage}
              tagLabels={tagLabels}
              next={upcoming[0] ?? null}
            />
          </DashboardSection>
        ) : null}

        {isAdmin ? (
          <DashboardSection
            eyebrow="Administrator"
            title="Platformen i tal"
            lead="Et kort resumé. Detaljerne ligger i driftsoverblikket og honoraropgørelsen."
          >
            <AdminDashboard ops={ops} />
          </DashboardSection>
        ) : null}

        <div className="section-rule">
          <form action={signOutAction}>
            <PrimaryButton type="submit">Log ud</PrimaryButton>
          </form>
        </div>
      </PageBody>
    </>
  );
}
