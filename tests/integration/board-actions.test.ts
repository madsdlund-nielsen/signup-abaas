import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "@/server/auth";
import { boardTables, createFakeDb, FakeBookingProvider, IDS, type FakeDb } from "./support/board-fakes";

/**
 * Server actions for boardets sammensætning (ADR 0062): admins vej og ejerens vej. Sessionen,
 * service-klienten, Cal.com og Next's cache/redirect mockes; selve invarianterne, lead-reglerne og
 * hosts-opdateringen kører som i produktion. Rolle-grænserne (negative cases) er kernen: ejer,
 * partner og anonym må ikke nå admins vej, og en fremmed ejer må ikke nå et andet boards.
 */
const mocked = vi.hoisted(() => ({
  db: null as unknown,
  user: null as unknown,
  booking: null as unknown,
}));
vi.mock("@/server/auth/supabase-server", () => ({
  createServiceSupabase: () => (mocked.db as FakeDb).client,
  createServerSupabase: async () => (mocked.db as FakeDb).client,
}));
vi.mock("@/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth")>()),
  getCurrentUser: async () => mocked.user,
}));
vi.mock("@/lib/booking", () => ({ createBookingProvider: () => mocked.booking }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));

const { adminAddBoardPartner, adminRemoveBoardPartner, adminSetBoardLead, adminSwapBoardPartner } = await import(
  "@/server/boards/admin-actions"
);
const { addBoardPartner, approveBoard, removeBoardPartner, setBoardLead, swapBoardPartner } = await import(
  "@/server/boards/actions"
);
const { HOSTS_WARNING } = await import("@/server/boards/composition");
const { revalidatePath } = await import("next/cache");

const db = () => mocked.db as FakeDb;
const booking = () => mocked.booking as FakeBookingProvider;

function user(...roles: AuthUser["roles"]): AuthUser {
  return { id: roles.includes("admin") ? IDS.admin : IDS.owner, email: "u@example.com", roles };
}
function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}
function memberIds(): string[] {
  return db()
    .tables.board_partner.map((r) => r.partner_id as string)
    .sort();
}
function leadIds(): string[] {
  return db()
    .tables.board_partner.filter((r) => r.is_lead)
    .map((r) => r.partner_id as string);
}

beforeEach(() => {
  mocked.db = createFakeDb(boardTables());
  mocked.booking = new FakeBookingProvider();
  mocked.user = user("admin");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  vi.stubEnv("FLAG_LEADPARTNER", "");
  vi.mocked(revalidatePath).mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("admin: tilføj, fjern, udskift", () => {
  it("tilføjer en partner, opdaterer hosts, logger som admin og genvalidérer siderne", async () => {
    const state = await adminAddBoardPartner({}, form({ board_id: IDS.board, partner: IDS.carl }));

    expect(state).toEqual({ notice: "Partneren er tilføjet boardet." });
    expect(memberIds()).toEqual([IDS.anna, IDS.bo, IDS.carl]);
    expect(booking().upserts).toHaveLength(1);
    expect(db().tables.board_change[0]).toMatchObject({ actor_id: IDS.admin, actor_role: "admin", action: "tilfoej" });
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/boards/${IDS.board}`);
    expect(revalidatePath).toHaveBeenCalledWith("/board");
  });

  it("udskifter en partner; lead går til den indkommende interne", async () => {
    // Succes redirecter til boardet med en statuslinje (B-71) — sektionen formularen står i er væk.
    await expect(
      adminSwapBoardPartner({}, form({ board_id: IDS.board, outgoing: IDS.anna, incoming: IDS.dorte })),
    ).rejects.toMatchObject({
      to: `/admin/boards/${IDS.board}?skiftet=${IDS.dorte}&fra=${IDS.anna}`,
    });
    expect(memberIds()).toEqual([IDS.bo, IDS.dorte]);
    expect(leadIds()).toEqual([IDS.dorte]);
  });

  it("fjerner en partner fra et fuldt board; fjernes lead'en, flyttes markeringen til en intern", async () => {
    await adminAddBoardPartner({}, form({ board_id: IDS.board, partner: IDS.carl }));
    const state = await adminRemoveBoardPartner({}, form({ board_id: IDS.board, partner: IDS.anna }));
    expect(state.notice).toBe("Partneren er fjernet fra boardet.");
    expect(memberIds()).toEqual([IDS.bo, IDS.carl]);
    expect(leadIds()).toEqual([IDS.bo]);
  });

  it("Cal.com-fejl: sammensætningen står, svaret bærer advarslen 'kør Opdatér hosts'", async () => {
    booking().failWith = new Error("Cal.com svarede 502");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const state = await adminAddBoardPartner({}, form({ board_id: IDS.board, partner: IDS.carl }));

    expect(state.error).toBeUndefined();
    expect(state.notice).toBe("Partneren er tilføjet boardet.");
    expect(state.warning).toContain(HOSTS_WARNING);
    expect(state.warning).toContain("Cal.com svarede 502");
    expect(memberIds()).toEqual([IDS.anna, IDS.bo, IDS.carl]);
    expect(db().tables.board_change[0]).toMatchObject({ calcom_sync: "fejlet" });
  });

  it("NEGATIV: invariant-brud afvises med en dansk fejl, og intet er skrevet", async () => {
    const tooFew = await adminRemoveBoardPartner({}, form({ board_id: IDS.board, partner: IDS.bo }));
    expect(tooFew.error).toMatch(/2-3 partnere/);

    await adminAddBoardPartner({}, form({ board_id: IDS.board, partner: IDS.carl }));
    const tooMany = await adminAddBoardPartner({}, form({ board_id: IDS.board, partner: IDS.dorte }));
    expect(tooMany.error).toMatch(/2-3 partnere/);

    const duplicate = await adminAddBoardPartner({}, form({ board_id: IDS.board, partner: IDS.anna }));
    expect(duplicate.error).toMatch(/allerede/);

    expect(memberIds()).toEqual([IDS.anna, IDS.bo, IDS.carl]);
    expect(db().tables.board_change).toHaveLength(1); // kun den ene vellykkede tilføjelse
  });

  it("manglende felter og ukendt board giver fejl, ikke en kastet undtagelse", async () => {
    expect((await adminAddBoardPartner({}, form({ board_id: IDS.board }))).error).toMatch(/Vælg en partner/);
    expect((await adminAddBoardPartner({}, form({ partner: IDS.carl }))).error).toMatch(/Board-id/);
    expect((await adminAddBoardPartner({}, form({ board_id: "nej", partner: IDS.carl }))).error).toBe(
      "Board ikke fundet.",
    );
    expect(
      (await adminSwapBoardPartner({}, form({ board_id: IDS.board, outgoing: IDS.bo, incoming: IDS.bo }))).error,
    ).toMatch(/anden partner/);
  });
});

describe("admin: lead (bag flaget leadPartner)", () => {
  it("NEGATIV: med flaget slået fra afvises markeringen", async () => {
    const state = await adminSetBoardLead({}, form({ board_id: IDS.board, partner: IDS.bo }));
    expect(state.error).toMatch(/ikke slået til/);
    expect(leadIds()).toEqual([IDS.anna]);
  });

  it("med flaget tændt flyttes lead til en intern partner på boardet — uden at røre Cal.com", async () => {
    vi.stubEnv("FLAG_LEADPARTNER", "true");
    const state = await adminSetBoardLead({}, form({ board_id: IDS.board, partner: IDS.bo }));
    expect(state).toEqual({ notice: "Lead-partneren er sat." });
    expect(leadIds()).toEqual([IDS.bo]);
    expect(booking().upserts).toEqual([]);
  });

  it("NEGATIV: en ekstern partner kan ikke være lead", async () => {
    vi.stubEnv("FLAG_LEADPARTNER", "true");
    await adminAddBoardPartner({}, form({ board_id: IDS.board, partner: IDS.carl }));
    const state = await adminSetBoardLead({}, form({ board_id: IDS.board, partner: IDS.carl }));
    expect(state.error).toMatch(/intern partner/);
    expect(leadIds()).toEqual([IDS.anna]);
  });
});

describe("admin: NEGATIV — kun rollen admin", () => {
  const cases: Array<[string, AuthUser | null]> = [
    ["ejer", user("ejer")],
    ["partner", user("partner")],
    ["lead_partner", user("lead_partner")],
    ["anonym", null],
  ];

  it.each(cases)("%s afvises før noget røres", async (_label, who) => {
    mocked.user = who;
    const before = JSON.stringify(db().tables);

    for (const state of [
      await adminAddBoardPartner({}, form({ board_id: IDS.board, partner: IDS.carl })),
      await adminRemoveBoardPartner({}, form({ board_id: IDS.board, partner: IDS.bo })),
      await adminSwapBoardPartner({}, form({ board_id: IDS.board, outgoing: IDS.bo, incoming: IDS.dorte })),
    ]) {
      expect(state.error).toMatch(/Adgang nægtet/);
    }

    expect(db().touched).toEqual([]);
    expect(JSON.stringify(db().tables)).toBe(before);
    expect(booking().upserts).toEqual([]);
  });

  it("lead-handlingen kan heller ikke nås af en ejer, selv med flaget tændt", async () => {
    vi.stubEnv("FLAG_LEADPARTNER", "true");
    mocked.user = user("ejer");
    const state = await adminSetBoardLead({}, form({ board_id: IDS.board, partner: IDS.bo }));
    expect(state.error).toMatch(/Adgang nægtet/);
    expect(db().touched).toEqual([]);
  });

  it("uden Supabase-konfiguration fejler den højlydt", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const state = await adminAddBoardPartner({}, form({ board_id: IDS.board, partner: IDS.carl }));
    expect(state.error).toMatch(/ikke konfigureret/);
  });
});

describe("ejer: samme invarianter, eget board", () => {
  beforeEach(() => {
    mocked.user = user("ejer");
  });

  it("udskift: skriver, opdaterer hosts, logger som ejer og redirecter med delta-parametre", async () => {
    await expect(
      swapBoardPartner(form({ board_id: IDS.board, outgoing: IDS.bo, incoming: IDS.dorte })),
    ).rejects.toMatchObject({ to: `/board?udskiftet=${IDS.bo}&til=${IDS.dorte}` });

    expect(memberIds()).toEqual([IDS.anna, IDS.dorte]);
    expect(booking().upserts).toHaveLength(1);
    expect(db().tables.board_change[0]).toMatchObject({ actor_id: IDS.owner, actor_role: "ejer", action: "udskift" });
  });

  it("udskift af lead med en ekstern: lead går til den første interne (uændret regel)", async () => {
    await addBoardPartner(form({ board_id: IDS.board, partner: IDS.carl }));
    await expect(
      swapBoardPartner(form({ board_id: IDS.board, outgoing: IDS.anna, incoming: IDS.erik })),
    ).rejects.toBeInstanceOf(RedirectSignal);
    expect(leadIds()).toEqual([IDS.bo]);
  });

  it("tilføj og fjern virker, og lead'en flyttes når den fjernes", async () => {
    await addBoardPartner(form({ board_id: IDS.board, partner: IDS.carl }));
    await removeBoardPartner(form({ board_id: IDS.board, partner: IDS.anna }));
    expect(memberIds()).toEqual([IDS.bo, IDS.carl]);
    expect(leadIds()).toEqual([IDS.bo]);
  });

  it("en Cal.com-fejl bliver ikke vist for ejeren: handlingen lykkes, og fejlen står på sporet", async () => {
    booking().failWith = new Error("Cal.com nede");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      swapBoardPartner(form({ board_id: IDS.board, outgoing: IDS.bo, incoming: IDS.dorte })),
    ).rejects.toBeInstanceOf(RedirectSignal);
    expect(memberIds()).toEqual([IDS.anna, IDS.dorte]);
    expect(db().tables.board_change[0]).toMatchObject({ calcom_sync: "fejlet" });
  });

  it("NEGATIV: invariant-brud kaster, og intet er skrevet", async () => {
    await expect(removeBoardPartner(form({ board_id: IDS.board, partner: IDS.bo }))).rejects.toThrow(/2-3 partnere/);
    await expect(addBoardPartner(form({ board_id: IDS.board, partner: IDS.anna }))).rejects.toThrow(/allerede/);
    expect(memberIds()).toEqual([IDS.anna, IDS.bo]);
    expect(db().tables.board_change).toEqual([]);
  });

  it("NEGATIV: en fremmed ejer kan ikke ændre et andet boards sammensætning", async () => {
    mocked.user = { id: "owner-2", email: "o2@example.com", roles: ["ejer"] };
    await expect(addBoardPartner(form({ board_id: IDS.board, partner: IDS.carl }))).rejects.toThrow(
      "Board ikke fundet.",
    );
    await expect(
      swapBoardPartner(form({ board_id: IDS.board, outgoing: IDS.bo, incoming: IDS.dorte })),
    ).rejects.toThrow("Board ikke fundet.");
    await expect(removeBoardPartner(form({ board_id: IDS.board, partner: IDS.bo }))).rejects.toThrow(
      "Board ikke fundet.",
    );
    expect(memberIds()).toEqual([IDS.anna, IDS.bo]);
    expect(booking().upserts).toEqual([]);
  });

  it("NEGATIV: partner, admin og anonym har ikke ejer-vejen", async () => {
    for (const who of [user("partner"), user("admin"), null]) {
      mocked.user = who;
      await expect(addBoardPartner(form({ board_id: IDS.board, partner: IDS.carl }))).rejects.toThrow(
        /Adgang nægtet/,
      );
    }
    expect(db().touched).toEqual([]);
  });

  it("lead-markering er stadig bag flaget, og en ekstern kan ikke være lead", async () => {
    await expect(setBoardLead(form({ board_id: IDS.board, partner: IDS.bo }))).rejects.toThrow(/ikke slået til/);
    vi.stubEnv("FLAG_LEADPARTNER", "true");
    await setBoardLead(form({ board_id: IDS.board, partner: IDS.bo }));
    expect(leadIds()).toEqual([IDS.bo]);

    await addBoardPartner(form({ board_id: IDS.board, partner: IDS.carl }));
    await expect(setBoardLead(form({ board_id: IDS.board, partner: IDS.carl }))).rejects.toThrow(/intern partner/);
    expect(leadIds()).toEqual([IDS.bo]);
  });

  it("godkend board: opretter board med lead på den første interne, og afviser et board uden intern", async () => {
    mocked.db = createFakeDb(boardTables({ board: [], board_partner: [] }));
    await expect(approveBoard(form({ partner: [IDS.carl, IDS.dorte] }))).rejects.toMatchObject({ to: "/board" });
    expect(db().tables.board).toHaveLength(1);
    expect(db().tables.board_partner).toEqual([
      expect.objectContaining({ partner_id: IDS.carl, is_lead: false }),
      expect.objectContaining({ partner_id: IDS.dorte, is_lead: true }),
    ]);

    mocked.db = createFakeDb(boardTables({ board: [], board_partner: [] }));
    await expect(approveBoard(form({ partner: [IDS.carl, IDS.erik] }))).rejects.toThrow(/mindst én intern/);
    expect(db().tables.board).toHaveLength(0);
  });
});
