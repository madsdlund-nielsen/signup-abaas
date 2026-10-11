import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  AdminBoardEditor,
  AdminBoardTable,
  describeBoardChange,
  type AdminBoardEditorActions,
} from "@/components/AdminBoards";
import { BoardActionForm } from "@/components/BoardActionForm";
import type { AdminBoardDetail, AdminBoardMember, AdminBoardOverview } from "@/server/boards/admin";
import type { BoardChangeRow } from "@/server/boards/audit";

/**
 * Admins board-flade (ADR 0062): overblikket og editoren. Rene præsentationskomponenter — data og
 * handlinger er props, så vi kan teste hvad admin faktisk ser og kan trykke på. Alle navne og
 * tekster er åbenlyst syntetiske.
 */
function member(overrides: Partial<AdminBoardMember>): AdminBoardMember {
  return {
    partnerId: "p-anna",
    name: "[DEMO] Anna",
    title: null,
    isInternal: true,
    isLead: false,
    hasCalcomUser: true,
    competenceTagIds: [],
    ...overrides,
  };
}

function overview(overrides: Partial<AdminBoardOverview> = {}): AdminBoardOverview {
  return {
    id: "board-1",
    name: "[DEMO] Board",
    ownerLabel: "[DEMO] Ejer",
    ownerEmail: "ejer@example.com",
    members: [member({ isLead: true }), member({ partnerId: "p-carl", name: "[DEMO] Carl", isInternal: false })],
    meetingCount: 3,
    membershipStatus: "aktiv",
    calcomEventTypeId: 4242,
    hostsOutOfSync: false,
    ...overrides,
  };
}

const pool = [
  { id: "p-anna", name: "[DEMO] Anna", isInternal: true, sortOrder: 1, competenceTagIds: ["t1"], title: null, shortBio: null, longBio: null, photoUrl: null },
  { id: "p-carl", name: "[DEMO] Carl", isInternal: false, sortOrder: 2, competenceTagIds: ["t2"], title: null, shortBio: null, longBio: null, photoUrl: null },
  { id: "p-dorte", name: "[DEMO] Dorte", isInternal: true, sortOrder: 3, competenceTagIds: ["t3"], title: null, shortBio: null, longBio: null, photoUrl: null },
  { id: "p-erik", name: "[DEMO] Erik", isInternal: false, sortOrder: 4, competenceTagIds: [], title: null, shortBio: null, longBio: null, photoUrl: null },
];

function detail(overrides: Partial<AdminBoardDetail> = {}): AdminBoardDetail {
  return {
    ...overview(),
    members: [
      member({ isLead: true, competenceTagIds: ["t1"] }),
      member({ partnerId: "p-carl", name: "[DEMO] Carl", isInternal: false, competenceTagIds: ["t2"] }),
    ],
    ownerId: "owner-1",
    ownerTagIds: ["t1", "t2", "t3"],
    pool,
    changes: [],
    ...overrides,
  };
}

const TAGS = { t1: "Salg", t2: "Økonomi", t3: "Drift" };

function actions(overrides: Partial<AdminBoardEditorActions> = {}): AdminBoardEditorActions {
  const ok = async () => ({ notice: "Gemt." });
  return { add: ok, remove: ok, swap: ok, setLead: ok, syncHosts: async () => ({}), ...overrides };
}

function renderEditor(
  board: AdminBoardDetail,
  extra: { showLead?: boolean; swapOutgoingId?: string | null; swapped?: { incomingId: string; outgoingId: string } | null } = {},
) {
  return render(
    <AdminBoardEditor
      board={board}
      tagLabels={TAGS}
      showLead={extra.showLead ?? false}
      swapOutgoingId={extra.swapOutgoingId ?? null}
      swapped={extra.swapped ?? null}
      actions={actions()}
    />,
  );
}

describe("AdminBoardTable", () => {
  it("viser ejer, partnere med intern/ekstern og lead, møder, medlemskab og Cal.com — med link til editoren", () => {
    const { container } = render(<AdminBoardTable boards={[overview()]} />);

    expect(screen.getByRole("link", { name: "[DEMO] Board" }).getAttribute("href")).toBe("/admin/boards/board-1");
    const text = container.textContent ?? "";
    expect(text).toContain("[DEMO] Ejer");
    expect(text).toContain("[DEMO] Anna (intern, lead)");
    expect(text).toContain("[DEMO] Carl (ekstern)");
    expect(text).toContain("Aktivt");
    expect(text).toContain("Event type 4242");
    expect(text).not.toContain("Hosts hænger efter");
  });

  it("markerer et board hvis Cal.com-hosts hænger efter, og et uden event type eller medlemskab", () => {
    const { container } = render(
      <AdminBoardTable
        boards={[overview({ hostsOutOfSync: true }), overview({ id: "b2", calcomEventTypeId: null, membershipStatus: null })]}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Hosts hænger efter");
    expect(text).toContain("Ikke oprettet");
    expect(text).toContain("Intet endnu");
  });

  it("bruger kun token-klasser: ingen inline-styles", () => {
    const { container } = render(<AdminBoardTable boards={[overview()]} />);
    expect(container.querySelector("[style]")).toBeNull();
  });
});

describe("AdminBoardEditor", () => {
  it("viser medlemmerne med type, lead og Cal.com-sæde", () => {
    const { container } = renderEditor(
      detail({
        members: [
          member({ isLead: true }),
          member({ partnerId: "p-carl", name: "[DEMO] Carl", isInternal: false, hasCalcomUser: false }),
        ],
      }),
    );
    expect(container.querySelector(".status-badge--live")?.textContent).toBe("Lead");
    expect(screen.getByText("Mangler")).toBeTruthy();
    expect(screen.getAllByText("Ekstern").length).toBeGreaterThan(0);
  });

  it("lead-knappen findes kun bag flaget, og kun for interne ikke-leads", () => {
    const board = detail({
      members: [
        member({ isLead: true }),
        member({ partnerId: "p-bo", name: "[DEMO] Bo" }),
        member({ partnerId: "p-carl", name: "[DEMO] Carl", isInternal: false }),
      ],
    });
    const { unmount } = renderEditor(board, { showLead: false });
    expect(screen.queryByRole("button", { name: "Gør til lead" })).toBeNull();
    unmount();

    renderEditor(board, { showLead: true });
    expect(screen.getAllByRole("button", { name: "Gør til lead" })).toHaveLength(1);
  });

  it("'Fjern' skjules når boardet er nede på minimumsstørrelsen", () => {
    renderEditor(detail());
    expect(screen.queryByRole("button", { name: "Fjern" })).toBeNull();
  });

  it("'Fjern' vises ved tre partnere, og 'Tilføj' erstattes af en forklaring", () => {
    renderEditor(
      detail({
        members: [
          member({ isLead: true }),
          member({ partnerId: "p-bo", name: "[DEMO] Bo" }),
          member({ partnerId: "p-carl", name: "[DEMO] Carl", isInternal: false }),
        ],
      }),
    );
    expect(screen.getAllByRole("button", { name: "Fjern" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Tilføj" })).toBeNull();
    expect(screen.getByText(/Boardet er fuldt/)).toBeTruthy();
  });

  it("tilføj-listen rummer kun partnere uden for boardet", () => {
    const { container } = renderEditor(detail());
    const options = [...container.querySelectorAll("select[name='partner'] option")].map((o) => o.textContent);
    expect(options).toEqual(["Vælg partner", "[DEMO] Dorte (intern)", "[DEMO] Erik (ekstern)"]);
  });

  it("dækningen viser hvem der dækker hvert behov, og hvad der ikke er dækket", () => {
    const { container } = renderEditor(detail());
    const text = container.textContent ?? "";
    expect(text).toContain("Salg");
    expect(text).toContain("Ikke dækket");
  });

  it("ejerens behov der ikke kunne læses vises som en advarsel, ikke som 'ingen behov'", () => {
    renderEditor(detail({ ownerTagIds: null }));
    expect(screen.getByText("Ejerens behov kunne ikke læses.")).toBeTruthy();
  });

  it("udskift åbner kandidatlisten med delta og spærrer en udskiftning der ville fjerne den sidste interne", () => {
    const { container } = renderEditor(detail(), { swapOutgoingId: "p-anna" });
    const text = container.textContent ?? "";
    expect(text).toContain("Udskift [DEMO] Anna");
    // Dorte (intern) tilfører Drift og fjerner Salg.
    expect(text).toContain("Drift");
    // Erik er ekstern og Carl er ekstern → uden Anna ville boardet mangle en intern.
    expect(text).toContain("Boardet ville mangle en intern partner");
    expect(screen.getAllByRole("button", { name: "Udskift med denne" })).toHaveLength(1);
  });

  it("udskift af den eksterne tillader alle kandidater", () => {
    renderEditor(detail(), { swapOutgoingId: "p-carl" });
    expect(screen.getAllByRole("button", { name: "Udskift med denne" })).toHaveLength(2);
  });

  it("bekræfter et netop gennemført skifte uden for udskift-sektionen (B-71)", () => {
    // Anna er udskiftet med Carl: Carl sidder nu på boardet, Anna er ude, og «Udskift»-sektionen er væk.
    const board = detail({ members: [member({ partnerId: "p-carl", name: "[DEMO] Carl", isInternal: false })] });
    const { container } = renderEditor(board, { swapped: { incomingId: "p-carl", outgoingId: "p-anna" } });
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Partneren er udskiftet: [DEMO] Anna er erstattet af [DEMO] Carl");
    expect(container.textContent).not.toContain("Udskift med denne");
  });

  it("påstår ikke et skifte der ikke er sket (ukendt eller uændret board)", () => {
    // Den indkommende sidder ikke på boardet, eller den udgående sidder der stadig.
    renderEditor(detail(), { swapped: { incomingId: "p-carl", outgoingId: "p-anna" } });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("hosts-advarslen vises kun når hosts hænger efter; manglende sæder vises altid", () => {
    const { unmount } = renderEditor(detail());
    expect(screen.queryByText(/Cal.com-hosts ikke opdateret/)).toBeNull();
    unmount();

    renderEditor(detail({ hostsOutOfSync: true, members: [member({ hasCalcomUser: false, isLead: true }), member({ partnerId: "p-carl", name: "[DEMO] Carl", isInternal: false })] }));
    expect(screen.getByText(/Cal.com-hosts ikke opdateret — kør Opdatér hosts/)).toBeTruthy();
    expect(screen.getByText(/Mangler Cal.com-bruger-id: \[DEMO\] Anna/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Opdatér hosts på Cal.com-event type" })).toBeTruthy();
  });

  it("uden event type tilbyder knappen at oprette det", () => {
    renderEditor(detail({ calcomEventTypeId: null }));
    expect(screen.getByRole("button", { name: "Opret Cal.com-event type" })).toBeTruthy();
  });

  it("historikken beskriver ændringerne uden persondata, og en slettet partner bliver 'en slettet partner'", () => {
    const changes: BoardChangeRow[] = [
      { id: "c1", boardId: "board-1", actorRole: "admin", action: "udskift", partnerId: "p-dorte", replacedPartnerId: "p-gone", calcomSync: "fejlet", createdAt: "2026-10-11T10:00:00Z" },
    ];
    const { container } = renderEditor(detail({ changes }));
    const text = container.textContent ?? "";
    expect(text).toContain("Admin udskiftede en slettet partner med [DEMO] Dorte");
    expect(text).toContain("Fejlede");
  });

  it("bruger kun token-klasser: ingen inline-styles", () => {
    const { container } = renderEditor(detail(), { swapOutgoingId: "p-carl", showLead: true });
    expect(container.querySelector("[style]")).toBeNull();
  });
});

describe("describeBoardChange", () => {
  const base: BoardChangeRow = {
    id: "c",
    boardId: "b",
    actorRole: "ejer",
    action: "tilfoej",
    partnerId: "p1",
    replacedPartnerId: null,
    calcomSync: "sprunget_over",
    createdAt: "2026-10-11T10:00:00Z",
  };
  const nameOf = (id: string | null) => (id === "p1" ? "Anna" : "en slettet partner");

  it("beskriver hver handling med aktørens rolle", () => {
    expect(describeBoardChange(base, nameOf)).toBe("Ejeren tilføjede Anna");
    expect(describeBoardChange({ ...base, action: "fjern", actorRole: "admin" }, nameOf)).toBe("Admin fjernede Anna");
    expect(describeBoardChange({ ...base, action: "saet_lead" }, nameOf)).toBe("Ejeren satte lead: Anna");
    expect(describeBoardChange({ ...base, action: "opdater_hosts", partnerId: null }, nameOf)).toBe(
      "Ejeren opdaterede Cal.com-hosts",
    );
  });
});

describe("BoardActionForm", () => {
  it("viser fejl, advarsel og bekræftelse fra handlingen", async () => {
    const action = vi.fn(async () => ({ notice: "Gjort.", warning: "Cal.com-hosts ikke opdateret — kør Opdatér hosts." }));
    render(<BoardActionForm action={action} submitLabel="Gør det" />);

    fireEvent.click(screen.getByRole("button", { name: "Gør det" }));

    await waitFor(() => expect(screen.getByText("Gjort.")).toBeTruthy());
    expect(screen.getByText(/Cal.com-hosts ikke opdateret/)).toBeTruthy();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("en fejl skjuler bekræftelsen", async () => {
    const action = vi.fn(async () => ({ error: "Et board skal bestå af 2-3 partnere.", notice: "Skjules." }));
    render(<BoardActionForm action={action} submitLabel="Fjern" />);

    fireEvent.click(screen.getByRole("button", { name: "Fjern" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("2-3 partnere"));
    expect(screen.queryByText("Skjules.")).toBeNull();
  });
});
