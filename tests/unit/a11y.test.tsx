import axe, { type AxeResults, type Result } from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { AuthForm } from "@/components/AuthForm";
import {
  AdminDashboard,
  OwnerDashboard,
  PartnerDashboard,
} from "@/components/Dashboard";
import { ErrorPage } from "@/components/ErrorPage";
import { FeeFigures, FeeLinesTable, FeeNotices, PeriodNav } from "@/components/FeeStatement";
import { Field } from "@/components/Field";
import { CoverageOverview, LeadDashboard } from "@/components/LeadDashboard";
import { NotificationOverview } from "@/components/NotificationOverview";
import { OpsOverview } from "@/components/OpsOverview";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { TopBar } from "@/components/TopBar";
import { TemplateEditor } from "@/components/TemplateEditor";
import Home from "@/app/page";
import NotFound from "@/app/not-found";
import RouteError from "@/app/error";
import type { OpsOverview as OpsState, IntegrationOverview } from "@/server/admin";
import type { OwnerBoard } from "@/server/boards";
import { computeBoardCoverage } from "@/server/dashboard/coverage";
import type { DashboardMeeting } from "@/server/dashboard/meetings";
import { summarizeFees, type FeeRuleInput } from "@/server/fees/algorithm";
import { buildFeeLines } from "@/server/fees/lines";
import type { Membership } from "@/server/memberships";
import type { NotificationOverviewState } from "@/server/notifications";
import { NOTIFICATION_TYPES } from "@/server/notifications/catalog";
import { PREVIEW_EXAMPLES } from "@/server/notifications/examples";
import { groupByChannel, type TemplateVersion } from "@/server/notifications/template-state";

/**
 * Tilgængelighedsgate (fase 6.2, ADR 0070): axe-core mod de vigtigste komponenter og sider der
 * kan renderes i jsdom. Det er ingen erstatning for en ægte skærmlæsertest, men det fanger de
 * fejl der koster mest at finde bagefter: manglende labels, tomme links og knapper, ugyldige
 * ARIA-attributter, hoppende overskriftsniveauer og dubletter af landmarks.
 *
 * Det axe IKKE kan i jsdom, og som derfor dækkes andetsteds:
 *  - farvekontrast (jsdom har intet layout) → tests/unit/contrast.test.ts regner direkte på tokens
 *  - fokus-synlighed og tastaturrækkefølge → verificeret manuelt i Chromium (ADR 0070)
 *
 * Kendte fund der ikke rettes her står i docs/backlog.md (B-80 og frem).
 */

async function scan(container: Element): Promise<Result[]> {
  const results: AxeResults = await axe.run(container, {
    // Kontrast kræver layout og returnerer "incomplete" i jsdom — se modulkommentaren.
    rules: { "color-contrast": { enabled: false } },
    // Komponenter renderes som fragmenter uden for en side; side-niveau-regler giver støj.
    resultTypes: ["violations"],
  });
  return results.violations;
}

function describeViolations(violations: Result[]): string {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `  ${n.html}`).join("\n")}`)
    .join("\n");
}

/** Renderer i en <main> — som alle rigtige sider — og forventer nul overtrædelser. */
async function expectAccessible(ui: ReactElement, { wrapInMain = true } = {}) {
  const { container } = render(wrapInMain ? <main>{ui}</main> : ui);
  const violations = await scan(container);
  expect(violations, describeViolations(violations)).toEqual([]);
}

/* ------------------------------------------------------------------ fixtures */

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

function meeting(id: string, startsAt: string): DashboardMeeting {
  return {
    id,
    boardId: "b1",
    startsAt,
    status: "planlagt",
    videoJoinUrl: "https://video.example/rum",
    participants: [
      { partnerProfileId: "p1", name: "Åse Lead", registeredStatus: null },
      { partnerProfileId: "p2", name: "Bo Medlem", registeredStatus: null },
    ],
  };
}

const MEMBERSHIP: Membership = {
  id: "m1",
  boardId: "b1",
  frequencyWeeks: 4,
  status: "aktiv",
  cardStatus: "mangler",
};

const RULE: FeeRuleInput = {
  id: "r1",
  version: 1,
  hourlyRateMinor: 100,
  currency: "DKK",
  vatMode: "ikke_fastlagt",
  absenceRule: "ikke_fastlagt",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
};

const FEE_ROWS = [
  {
    meetingId: "m1",
    partnerProfileId: "p1",
    partnerName: "Partner Én",
    startsAt: "2026-10-05T10:00:00Z",
    meetingStatus: "afholdt" as const,
    durationMinutes: 60,
    prepMinutes: 15,
    registeredStatus: "afholdt" as const,
  },
  {
    meetingId: "m2",
    partnerProfileId: "p1",
    partnerName: "Partner Én",
    startsAt: "2026-10-12T10:00:00Z",
    meetingStatus: "afholdt" as const,
    durationMinutes: 60,
    prepMinutes: 15,
    registeredStatus: null,
  },
];

const integrations: IntegrationOverview = {
  integrations: [
    {
      key: "booking",
      label: "Booking",
      vendor: "Cal.com (Teams)",
      flag: "booking",
      flagEnv: "FLAG_BOOKING",
      flagEnabled: false,
      mode: "stub",
      adapter: "stub",
    },
    {
      key: "payments",
      label: "Betaling ind",
      vendor: "Alunta",
      flag: "payments",
      flagEnv: "FLAG_PAYMENTS",
      flagEnabled: true,
      mode: "demo",
      adapter: "demo",
    },
  ],
  demoMode: true,
  counts: { real: 0, demo: 1, stub: 1 },
};

const ops: OpsState = {
  generatedAt: "2026-10-10T12:00:00.000Z",
  platform: { boards: 3, ownersWithBoard: 2, partners: 5, partnersLinked: 4, partnersUnlinked: 1 },
  memberships: { total: 2, active: 2, cancelled: 0, cardRegistered: 1, cardMissing: 1 },
  charges: {
    pending: 0,
    succeeded: 1,
    failed: 1,
    recentFailures: [{ id: "c1", failedAt: "2026-10-09T08:00:00Z", reason: "card_declined" }],
  },
  meetings: { windowDays: 30, upcoming: 2, overdue: 0, held: 4, cancelled: 1 },
  missingRegistrations: { meetings: 1, registrations: 2 },
  fees: {
    month: "2026-10",
    ruleCount: 0,
    totals: summarizeFees([{ kind: "ingen_sats" }, { kind: "ikke_registreret" }]),
  },
  webhooks: {
    meeting: [],
    payment: [{ provider: "alunta", eventType: "charge.failed", receivedAt: "2026-10-09T08:00:00Z" }],
  },
  truncated: false,
};

const notificationState: NotificationOverviewState = {
  channels: [
    {
      key: "email",
      label: "E-mail",
      vendor: "Resend (EU, Dublin)",
      flag: "email",
      state: "stub",
      flagEnabled: false,
      unlockedBy: "Resend-konto, nøgle og FLAG_EMAIL",
    },
  ],
  types: [
    {
      key: "meeting-reminder",
      label: "Mødepåmindelse",
      trigger: "Et kommende møde nærmer sig",
      recipients: "Ejer og boardets partnere",
      channels: ["email"],
      timing: null,
      schedule: null,
      variables: [],
    },
  ],
  anyChannelLive: false,
};

const TYPE = NOTIFICATION_TYPES.find((t) => t.key === "meeting-changed")!;

function templateVersion(overrides: Partial<TemplateVersion>): TemplateVersion {
  return {
    id: "v1",
    typeKey: TYPE.key,
    channel: "email",
    version: 1,
    status: "live",
    subject: "[DEMO] Emne {{aendring}}",
    body: "[DEMO] Tekst om {{board_navn}}",
    publishedAt: "2026-10-01T10:00:00Z",
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}

/* --------------------------------------------------------------------- tests */

describe("axe-gaten virker", () => {
  it("fanger et felt uden label og en knap uden navn (ellers beviser grønne tests intet)", async () => {
    const { container } = render(
      <main>
        <input name="x" />
        <button />
      </main>,
    );
    const ids = (await scan(container)).map((v) => v.id);
    expect(ids).toContain("label");
    expect(ids).toContain("button-name");
  });
});

describe("tilgængelighed — site-chrome og sider", () => {
  it("forsiden (alle bånd, overskriftshierarki og links)", async () => {
    await expectAccessible(<Home />, { wrapInMain: false });
  });

  it("404-siden", async () => {
    await expectAccessible(<NotFound />, { wrapInMain: false });
  });

  it("runtime-fejlsiden uden fejlreference", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expectAccessible(<RouteError error={new Error("intern fejl")} retry={vi.fn()} />, {
      wrapInMain: false,
    });
  });

  it("runtime-fejlsiden med fejlreference", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const withDigest = Object.assign(new Error("intern fejl"), { digest: "abc123" });
    await expectAccessible(<RouteError error={withDigest} retry={vi.fn()} />, { wrapInMain: false });
  });

  it("ErrorPage med handlinger", async () => {
    await expectAccessible(
      <ErrorPage eyebrow="Fejl" title="Titel" actions={<a href="/test">Hjem</a>}>
        Tekst
      </ErrorPage>,
      { wrapInMain: false },
    );
  });

  it("header og fod (landmarks, billedtekster og navigation)", async () => {
    const { container } = render(
      <>
        <TopBar>
          <a href="mailto:info@signupacademy.com">info@signupacademy.com</a>
        </TopBar>
        <SiteHeader />
        <main>
          <h1>Side</h1>
        </main>
        <SiteFooter />
      </>,
    );
    const violations = await scan(container);
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  it("sidehoved + indholdsflade", async () => {
    const { container } = render(
      <>
        <PageHeader eyebrow="Board" title="Dit advisory board" lead="Tre rådgivere" actions={<a href="/x">Book</a>} />
        <PageBody>
          <p>Indhold</p>
        </PageBody>
      </>,
    );
    const violations = await scan(container);
    expect(violations, describeViolations(violations)).toEqual([]);
  });
});

describe("tilgængelighed — formularer", () => {
  it("Field: label knyttet til input, også med required/autoComplete", async () => {
    await expectAccessible(
      <form>
        <Field name="email" label="E-mail" type="email" autoComplete="email" required />
        <Field name="password" label="Adgangskode" type="password" autoComplete="current-password" required />
      </form>,
    );
  });

  it("AuthForm med fejlnotits (role=alert)", async () => {
    const failing = async () => ({ error: "Forkert e-mail eller adgangskode." });
    const { container, getByRole } = render(
      <main>
        <AuthForm action={failing} submitLabel="Log ind" alt={<a href="/signup">Opret konto</a>}>
          <Field name="email" label="E-mail" type="email" required />
        </AuthForm>
      </main>,
    );
    const violations = await scan(container);
    expect(violations, describeViolations(violations)).toEqual([]);
    expect(getByRole("button", { name: "Log ind" })).toBeTruthy();
  });
});

describe("tilgængelighed — dashboards og drift", () => {
  it("ejer-dashboard (board, næste møde, betaling med kort mangler)", async () => {
    await expectAccessible(
      <OwnerDashboard
        board={BOARD}
        membership={MEMBERSHIP}
        upcoming={[meeting("m1", "2026-10-12T08:00:00Z"), meeting("m2", "2026-11-09T08:00:00Z")]}
      />,
    );
  });

  it("ejer-dashboard uden board (tomtilstand)", async () => {
    await expectAccessible(<OwnerDashboard board={null} membership={null} upcoming={[]} />);
  });

  it("partner-dashboard med honorar og tilgængelighed", async () => {
    await expectAccessible(
      <PartnerDashboard
        linked
        upcoming={[meeting("m1", "2026-10-12T08:00:00Z")]}
        fees={{ month: "2026-10", hasRules: false, totals: summarizeFees([]) }}
        availability={{ slotCount: 3, upcomingAbsenceCount: 1 }}
      />,
    );
  });

  it("lead-partnerens dækningsoverblik", async () => {
    const coverage = computeBoardCoverage(["salg", "oekonomi", "jura"], BOARD.members);
    await expectAccessible(
      <>
        <CoverageOverview coverage={coverage} tagLabels={{ salg: "Salg", oekonomi: "Økonomi", jura: "Jura" }} />
        <LeadDashboard
          boardName="Testboard"
          coverage={coverage}
          tagLabels={{ salg: "Salg", oekonomi: "Økonomi", jura: "Jura" }}
          next={null}
        />
      </>,
    );
  });

  it("admin-dashboard og driftsoverblik", async () => {
    await expectAccessible(
      <>
        <AdminDashboard ops={ops} />
        <OpsOverview ops={ops} integrations={integrations} />
      </>,
    );
  });

  it("driftsoverblik uden Supabase (ops = null)", async () => {
    await expectAccessible(<OpsOverview ops={null} integrations={integrations} />);
  });
});

describe("tilgængelighed — honorar og notifikationer", () => {
  it("honoraropgørelse (periodenavigation, tal, forbehold og linjetabel)", async () => {
    const lines = buildFeeLines(FEE_ROWS, [RULE]);
    const totals = summarizeFees(lines.map((line) => line.result));
    await expectAccessible(
      <>
        <PeriodNav month="2026-10" basePath="/admin/honorar" />
        <FeeFigures totals={totals} />
        <FeeNotices totals={totals} hasRules />
        <FeeLinesTable lines={lines} showPartner linkMeetings totals={totals} />
      </>,
    );
  });

  it("notifikationsoversigt", async () => {
    await expectAccessible(<NotificationOverview state={notificationState} />);
  });

  it("notifikationseditor (live + afvigende udkast, felter og forhåndsvisning)", async () => {
    const versions = [
      templateVersion({}),
      templateVersion({ id: "v2", version: 2, status: "udkast", publishedAt: null, body: "[DEMO] Ny tekst" }),
    ];
    const channels = groupByChannel(versions, TYPE.channels).map((state) => ({
      label: state.channel === "email" ? "E-mail" : "SMS",
      state,
    }));
    const actions = {
      save: vi.fn(async () => ({ notice: "Udkast gemt." })),
      publish: vi.fn(async () => ({ notice: "Publiceret." })),
      discard: vi.fn(async () => ({ notice: "Forkastet." })),
    };
    await expectAccessible(
      <TemplateEditor
        typeKey={TYPE.key}
        channels={channels}
        variables={TYPE.variables}
        examples={PREVIEW_EXAMPLES}
        actions={actions}
      />,
    );
  });
});
