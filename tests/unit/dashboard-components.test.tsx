import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  AdminDashboard,
  AvailabilityPanel,
  DashboardSection,
  OwnerDashboard,
  PartnerDashboard,
  PaymentPanel,
  RatingsPanel,
  SectionLinks,
} from "@/components/Dashboard";
import { CoverageOverview, LeadDashboard, NextMeetingResponsibility } from "@/components/LeadDashboard";
import type { OpsOverview } from "@/server/admin";
import type { OwnerBoard } from "@/server/boards";
import { computeBoardCoverage } from "@/server/dashboard/coverage";
import type { DashboardMeeting } from "@/server/dashboard/meetings";
import { summarizeFees } from "@/server/fees/algorithm";
import type { Membership } from "@/server/memberships";

/**
 * Rolle-dashboardenes komponenter (fase 5.4, ADR 0055). Token-klasser og ingen inline-styles,
 * og — vigtigere — skærmen lover ikke mere end den ved: ingen sats giver intet beløb, et hul
 * (vurderinger) siges højt, og en tom tilstand guider videre.
 */
function expectTokenOnly(container: HTMLElement) {
  expect(container.querySelectorAll("[style]")).toHaveLength(0);
}

function member(id: string, name: string, isLead = false, tags: string[] = []) {
  return {
    partnerId: id,
    name,
    isLead,
    title: null,
    isInternal: false,
    shortBio: null,
    longBio: null,
    photoUrl: null,
    sortOrder: 0,
    competenceTagIds: tags,
  };
}

const BOARD: OwnerBoard = {
  id: "b1",
  name: "Testboard",
  members: [member("p1", "Åse Lead", true, ["salg"]), member("p2", "Bo Medlem", false, ["oekonomi"])],
};

function meeting(id: string, startsAt: string, overrides: Partial<DashboardMeeting> = {}): DashboardMeeting {
  return {
    id,
    boardId: "b1",
    startsAt,
    status: "planlagt",
    videoJoinUrl: null,
    participants: [
      { partnerProfileId: "p1", name: "Åse Lead", registeredStatus: null },
      { partnerProfileId: "p2", name: "Bo Medlem", registeredStatus: null },
    ],
    ...overrides,
  };
}

const MEMBERSHIP: Membership = {
  id: "m1",
  boardId: "b1",
  frequencyWeeks: 4,
  status: "aktiv",
  cardStatus: "registreret",
};

describe("DashboardSection / SectionLinks", () => {
  it("giver rollen en eyebrow, en tynd overskrift og børnene", () => {
    const { container } = render(
      <DashboardSection eyebrow="Ejer" title="Dit board" lead="Forklaring">
        <p>indhold</p>
      </DashboardSection>,
    );
    expect(screen.getByText("Ejer").className).toContain("eyebrow");
    expect(screen.getByRole("heading", { name: "Dit board" }).className).toContain("heading-3");
    expect(screen.getByText("Forklaring")).toBeTruthy();
    expect(screen.getByText("indhold")).toBeTruthy();
    expect(container.querySelector(".dash-section")).toBeTruthy();
    expectTokenOnly(container);
  });

  it("indgangslinks til underfladerne", () => {
    render(<SectionLinks links={[{ href: "/board", label: "Dit board" }]} />);
    expect(screen.getByRole("link", { name: "Dit board" }).getAttribute("href")).toBe("/board");
  });
});

describe("OwnerDashboard", () => {
  it("uden board guider tomtilstanden til onboarding", () => {
    const { container } = render(<OwnerDashboard board={null} membership={null} upcoming={[]} />);
    expect(container.textContent).toMatch(/endnu ikke et board/);
    expect(screen.getByRole("link", { name: "Start onboarding" }).getAttribute("href")).toBe(
      "/onboarding",
    );
    expect(container.querySelector(".figures")).toBeNull();
    expectTokenOnly(container);
  });

  it("viser næste møde på dansk med deltagere, forberedelse og Deltag", () => {
    const upcoming = [
      meeting("m-next", "2026-10-12T08:00:00Z", { videoJoinUrl: "https://video.example/rum" }),
    ];
    const { container } = render(
      <OwnerDashboard board={BOARD} membership={MEMBERSHIP} upcoming={upcoming} />,
    );
    expect(container.textContent).toMatch(/12\. oktober/);
    expect(container.textContent).toMatch(/Med Åse Lead, Bo Medlem/);
    expect(screen.getByRole("link", { name: "Forberedelse" }).getAttribute("href")).toBe(
      "/moeder/m-next",
    );
    expect(screen.getByRole("link", { name: "Deltag" }).getAttribute("href")).toBe(
      "https://video.example/rum",
    );
    expectTokenOnly(container);
  });

  it("uden Deltag-link vises ingen Deltag-knap", () => {
    render(
      <OwnerDashboard
        board={BOARD}
        membership={MEMBERSHIP}
        upcoming={[meeting("m1", "2026-10-12T08:00:00Z")]}
      />,
    );
    expect(screen.queryByRole("link", { name: "Deltag" })).toBeNull();
  });

  it("viser antallet af kommende møder, men listen 'Herefter' højst tre efter det næste", () => {
    const upcoming = [1, 2, 3, 4, 5, 6].map((n) => meeting(`m${n}`, `2026-11-0${n}T10:00:00Z`));
    const { container } = render(
      <OwnerDashboard board={BOARD} membership={MEMBERSHIP} upcoming={upcoming} />,
    );
    const figures = container.querySelector(".figures");
    expect(figures?.textContent).toMatch(/Kommende møder/);
    expect(figures?.textContent).toMatch(/6/);
    // Det næste står i panelet; tabellen viser de tre derefter.
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(screen.getByText("Alle møder (6 kommende)")).toBeTruthy();
  });

  it("uden kommende møder guider panelet til at booke", () => {
    render(<OwnerDashboard board={BOARD} membership={MEMBERSHIP} upcoming={[]} />);
    expect(screen.getByRole("link", { name: "Book det næste møde" }).getAttribute("href")).toBe(
      "/moeder",
    );
  });

  it("markerer lead på boardet, uanset flag, og linker til /board", () => {
    const { container } = render(
      <OwnerDashboard board={BOARD} membership={MEMBERSHIP} upcoming={[]} />,
    );
    expect(screen.getByText("Åse Lead · Lead").className).toContain("partner-tag--match");
    expect(screen.getByText("Bo Medlem").className).not.toContain("partner-tag--match");
    expect(screen.getByRole("link", { name: "Se board" }).getAttribute("href")).toBe("/board");
    expect(container.textContent).toMatch(/Lead: Åse Lead/);
  });

  it("siger 'ingen lead markeret' når ingen er lead", () => {
    const board = { ...BOARD, members: BOARD.members.map((m) => ({ ...m, isLead: false })) };
    const { container } = render(
      <OwnerDashboard board={board} membership={MEMBERSHIP} upcoming={[]} />,
    );
    expect(container.textContent).toMatch(/Ingen lead markeret/);
  });
});

describe("PaymentPanel", () => {
  it("aktivt abonnement med kort: status og frekvens, intet CTA-pres", () => {
    const { container } = render(<PaymentPanel membership={MEMBERSHIP} />);
    expect(screen.getByText("Aktivt")).toBeTruthy();
    expect(container.textContent).toMatch(/Betalingskort: registreret/);
    expect(container.textContent).toMatch(/hver 4\. uge/);
    expect(container.querySelector(".form__notice")).toBeNull();
    expect(screen.getByRole("link", { name: "Se abonnement" }).getAttribute("href")).toBe("/betaling");
  });

  it("kort mangler på et aktivt abonnement: tydelig CTA til /betaling", () => {
    const { container } = render(
      <PaymentPanel membership={{ ...MEMBERSHIP, cardStatus: "mangler" }} />,
    );
    expect(container.querySelector(".form__notice")?.textContent).toMatch(/ikke registreret et betalingskort/);
    const cta = screen.getByRole("link", { name: "Registrér kort" });
    expect(cta.getAttribute("href")).toBe("/betaling");
    expect(cta.className).toContain("btn-primary");
  });

  it("opsagt abonnement: siger det, og presser ikke på kortregistrering", () => {
    const { container } = render(
      <PaymentPanel membership={{ ...MEMBERSHIP, status: "opsagt", cardStatus: "mangler" }} />,
    );
    expect(screen.getByText("Opsagt")).toBeTruthy();
    expect(container.querySelector(".form__notice")).toBeNull();
    expect(screen.queryByRole("link", { name: "Registrér kort" })).toBeNull();
  });

  it("intet abonnement endnu: guider til at oprette det", () => {
    render(<PaymentPanel membership={null} />);
    expect(screen.getByRole("link", { name: "Opret abonnement" }).getAttribute("href")).toBe(
      "/betaling",
    );
  });
});

describe("PartnerDashboard", () => {
  const noFees = summarizeFees([]);

  it("uden katalogkobling siges det, og intet andet vises", () => {
    const { container } = render(
      <PartnerDashboard linked={false} upcoming={[]} fees={null} availability={null} />,
    );
    expect(container.textContent).toMatch(/ikke koblet til en katalogprofil/);
    expect(container.querySelector(".figures")).toBeNull();
  });

  it("honorar uden sats: intet beløb, 'ikke fastlagt' siges højt — og aldrig '0 kr'", () => {
    const fees = {
      month: "2026-10",
      hasRules: false,
      totals: summarizeFees([{ kind: "ingen_sats" }, { kind: "ikke_registreret" }]),
    };
    const { container } = render(
      <PartnerDashboard linked upcoming={[]} fees={fees} availability={null} />,
    );
    expect(container.textContent).toMatch(/Honorar · Oktober 2026/);
    expect(container.textContent).toMatch(/Honorarsatsen er ikke fastlagt endnu/);
    expect(container.querySelector(".figure__value")?.textContent).toBe("—");
    expect(screen.getByRole("link", { name: "Se din opgørelse" }).getAttribute("href")).toBe(
      "/partner/honorar",
    );
  });

  it("honorar der afventer afbudsregel: tæller og forbehold, intet beløb for linjen", () => {
    const fees = {
      month: "2026-10",
      hasRules: true,
      totals: summarizeFees([
        { kind: "afventer_regel", basis: "udeblivelse", basisMinutes: 75, ruleVersion: 1 },
      ]),
    };
    const { container } = render(
      <PartnerDashboard linked upcoming={[]} fees={fees} availability={null} />,
    );
    expect(container.textContent).toMatch(/afventer en regel for honorar ved udeblivelse/);
  });

  it("honorar med en beregnet linje viser summen i kroner", () => {
    const fees = {
      month: "2026-10",
      hasRules: true,
      totals: summarizeFees([
        {
          kind: "beregnet",
          amountMinor: 100,
          currency: "DKK",
          basisMinutes: 75,
          basis: "afholdt",
          vatMode: "ikke_fastlagt",
          ruleVersion: 1,
        },
      ]),
    };
    const { container } = render(
      <PartnerDashboard linked upcoming={[]} fees={fees} availability={null} />,
    );
    expect(container.querySelector(".figure__value")?.textContent).toMatch(/1,00/);
  });

  it("vurderinger vises ikke som tal, men som et ærligt hul", () => {
    const { container } = render(<RatingsPanel />);
    expect(container.textContent).toMatch(/vises ikke endnu/);
    expect(container.textContent).not.toMatch(/\d[.,]\d/);
    expectTokenOnly(container);
  });

  it("tilgængelighed: angivet vs. ikke angivet, med link til redigering", () => {
    const { rerender, container } = render(
      <AvailabilityPanel summary={{ slotCount: 3, upcomingAbsenceCount: 1 }} />,
    );
    expect(screen.getByText("Angivet")).toBeTruthy();
    expect(container.textContent).toMatch(/3 faste tider om ugen/);
    expect(container.textContent).toMatch(/1 fraværsperiode på vej/);
    expect(screen.getByRole("link", { name: "Redigér tilgængelighed" }).getAttribute("href")).toBe(
      "/partner/tilgaengelighed",
    );

    rerender(<AvailabilityPanel summary={{ slotCount: 0, upcomingAbsenceCount: 0 }} />);
    expect(screen.getByText("Ikke angivet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Angiv tilgængelighed" })).toBeTruthy();
  });

  it("hele dashboardet er token-only og viser næste møde på partnerens board", () => {
    const { container } = render(
      <PartnerDashboard
        linked
        upcoming={[meeting("m1", "2026-10-12T08:00:00Z")]}
        fees={{ month: "2026-10", hasRules: false, totals: noFees }}
        availability={{ slotCount: 0, upcomingAbsenceCount: 0 }}
      />,
    );
    expect(container.textContent).toMatch(/12\. oktober/);
    expectTokenOnly(container);
  });
});

describe("LeadDashboard", () => {
  const tagLabels = { salg: "Salg", oekonomi: "Økonomi", jura: "Jura" };

  it("kompetenceoverblik: behov, dækket og udækket — med hvem der dækker", () => {
    const coverage = computeBoardCoverage(["salg", "oekonomi", "jura"], BOARD.members);
    const { container } = render(<CoverageOverview coverage={coverage} tagLabels={tagLabels} />);
    const figures = container.querySelector(".figures");
    expect(figures?.textContent).toMatch(/Ejerens behov/);
    expect(figures?.textContent).toMatch(/Dækket af boardet/);
    expect(figures?.textContent).toMatch(/Udækket/);
    const rows = [...container.querySelectorAll("tbody tr")].map((tr) => tr.textContent);
    expect(rows).toContain("SalgÅse Lead");
    expect(rows).toContain("ØkonomiBo Medlem");
    expect(rows).toContain("JuraUdækket");
    expectTokenOnly(container);
  });

  it("alle behov dækket siges", () => {
    const coverage = computeBoardCoverage(["salg"], BOARD.members);
    const { container } = render(<CoverageOverview coverage={coverage} tagLabels={tagLabels} />);
    expect(container.textContent).toMatch(/Alle behov er dækket/);
  });

  it("ukendt tag-id vises ikke som rå id", () => {
    const coverage = computeBoardCoverage(["ukendt-id"], BOARD.members);
    const { container } = render(<CoverageOverview coverage={coverage} tagLabels={tagLabels} />);
    expect(container.textContent).toMatch(/Ukendt kompetence/);
    expect(container.textContent).not.toMatch(/ukendt-id/);
  });

  it("ejeren har ingen behov endnu: tomtilstand, ikke et nul-overblik", () => {
    const { container } = render(
      <CoverageOverview coverage={computeBoardCoverage([], BOARD.members)} tagLabels={tagLabels} />,
    );
    expect(container.textContent).toMatch(/ikke angivet kompetencebehov/);
    expect(container.querySelector(".figures")).toBeNull();
  });

  it("behov der ikke kunne læses er et hul — ikke det samme som ingen behov", () => {
    const { container } = render(<CoverageOverview coverage={null} tagLabels={tagLabels} />);
    expect(container.textContent).toMatch(/kunne ikke læses/);
    expect(container.textContent).not.toMatch(/ikke angivet kompetencebehov/);
  });

  it("intet kommende møde: 'Initiér næste møde' fremhæves som primær handling til /partner", () => {
    const { container } = render(<NextMeetingResponsibility next={null} />);
    expect(container.querySelector(".form__notice")?.textContent).toMatch(/Der er ikke aftalt et næste møde/);
    const cta = screen.getByRole("link", { name: "Initiér næste møde" });
    expect(cta.getAttribute("href")).toBe("/partner");
    expect(cta.className).toContain("btn-primary");
  });

  it("aftalt næste møde: viser tidspunktet og ingen alarm", () => {
    const { container } = render(
      <NextMeetingResponsibility next={meeting("m9", "2026-10-12T08:00:00Z")} />,
    );
    expect(container.textContent).toMatch(/12\. oktober/);
    expect(container.querySelector(".form__notice")).toBeNull();
    expect(screen.queryByRole("link", { name: "Initiér næste møde" })).toBeNull();
    expect(screen.getByRole("link", { name: "Åbn mødet" }).getAttribute("href")).toBe("/moeder/m9");
  });

  it("det samlede lead-dashboard er token-only", () => {
    const { container } = render(
      <LeadDashboard
        boardName="Testboard"
        coverage={computeBoardCoverage(["salg"], BOARD.members)}
        tagLabels={tagLabels}
        next={null}
      />,
    );
    expect(container.textContent).toMatch(/Du er lead på dette board/);
    expectTokenOnly(container);
  });
});

describe("AdminDashboard", () => {
  const ops: OpsOverview = {
    generatedAt: "2026-10-10T12:00:00.000Z",
    platform: { boards: 3, ownersWithBoard: 2, partners: 5, partnersLinked: 4, partnersUnlinked: 1 },
    memberships: { total: 2, active: 2, cancelled: 0, cardRegistered: 1, cardMissing: 1 },
    charges: { pending: 0, succeeded: 1, failed: 1, recentFailures: [] },
    meetings: { windowDays: 30, upcoming: 2, overdue: 0, held: 4, cancelled: 1 },
    missingRegistrations: { meetings: 0, registrations: 0 },
    fees: { month: "2026-10", ruleCount: 0, totals: summarizeFees([{ kind: "ingen_sats" }]) },
    webhooks: { meeting: [], payment: [] },
    truncated: false,
  };

  it("tal først med links til drift, honorar og admin", () => {
    const { container } = render(<AdminDashboard ops={ops} />);
    expect(container.querySelectorAll(".stat").length).toBe(6);
    expect(screen.getByRole("link", { name: "Driftsoverblik" }).getAttribute("href")).toBe("/admin/drift");
    expect(screen.getByRole("link", { name: "Honorar" }).getAttribute("href")).toBe("/admin/honorar");
    expect(screen.getByRole("link", { name: "Administration" }).getAttribute("href")).toBe("/admin");
    expect(container.textContent).toMatch(/Honorarsatsen er ikke fastsat/);
    expectTokenOnly(container);
  });

  it("en sektion der ikke kunne læses er '—', aldrig et nul", () => {
    const { container } = render(<AdminDashboard ops={{ ...ops, charges: null, fees: null }} />);
    expect(container.textContent).toMatch(/Kunne ikke læses/);
    const failed = [...container.querySelectorAll(".stat")].find((el) => /Fejlede træk/.test(el.textContent ?? ""));
    expect(failed?.querySelector(".stat__value")?.textContent).toBe("—");
  });

  it("uden Supabase er der en tomtilstand i stedet for tal", () => {
    const { container } = render(<AdminDashboard ops={null} />);
    expect(container.textContent).toMatch(/kan ikke læses i dette miljø/);
    expect(container.querySelectorAll(".stat")).toHaveLength(0);
  });
});
