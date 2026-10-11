import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "@/server/auth";
import { boardTables, createFakeDb, FakeBookingProvider, IDS, type FakeDb } from "./support/board-fakes";

/**
 * Ændres en partners Cal.com-sæde, skal hosts skrives på hvert board partneren sidder på (B-67,
 * ADR 0064). Sessionen, service-klienten og Cal.com mockes; sæde-skrivningen, board-opslaget,
 * hosts-synkroniseringen og revisionssporet kører som i produktion. Rolle-grænsen er kernen af de
 * negative cases: kun admin kan ændre et sæde, og en afvist skrivning rører ikke Cal.com.
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

const { setPartnerCalcomUserId } = await import("@/server/meetings/booking-admin");
const { HOSTS_WARNING } = await import("@/server/boards/composition");

const db = () => mocked.db as FakeDb;
const booking = () => mocked.booking as FakeBookingProvider;

function user(...roles: AuthUser["roles"]): AuthUser {
  return { id: roles.includes("admin") ? IDS.admin : IDS.owner, email: "u@example.com", roles };
}
function form(partner: string, seat: string): FormData {
  const data = new FormData();
  data.append("partner_id", partner);
  data.append("calcom_user_id", seat);
  return data;
}
function seatOf(id: string): unknown {
  return db().tables.partner_profile.find((p) => p.id === id)?.calcom_user_id;
}

beforeEach(() => {
  mocked.db = createFakeDb(boardTables());
  mocked.booking = new FakeBookingProvider();
  mocked.user = user("admin");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("setPartnerCalcomUserId — hosts følger sædet", () => {
  it("nyt sæde: gemmes, og boardets hosts skrives med det nye id (ikke det gamle)", async () => {
    const state = await setPartnerCalcomUserId({}, form(IDS.bo, "99"));

    expect(seatOf(IDS.bo)).toBe(99);
    expect(booking().upserts).toHaveLength(1);
    expect(booking().upserts[0]).toMatchObject({ eventTypeId: 4242 });
    expect([...(booking().upserts[0]?.hostUserIds ?? [])].sort()).toEqual([11, 99]);
    expect(state.error).toBeUndefined();
    expect(state.warning).toBeUndefined();
    expect(state.notice).toMatch(/1 board/);
  });

  it("logger 'opdater_hosts' på revisionssporet med admin som aktør, så advarslen dækker denne vej", async () => {
    await setPartnerCalcomUserId({}, form(IDS.bo, "99"));
    expect(db().tables.board_change).toEqual([
      expect.objectContaining({
        board_id: IDS.board,
        actor_id: IDS.admin,
        actor_role: "admin",
        action: "opdater_hosts",
        partner_id: IDS.bo,
        calcom_sync: "opdateret",
      }),
    ]);
  });

  it("en partner på to boards opdaterer begge", async () => {
    const db2 = createFakeDb(
      boardTables({
        board: [
          { id: IDS.board, name: "[DEMO] Et", owner_id: IDS.owner, calcom_event_type_id: 4242 },
          { id: "board-2", name: "[DEMO] To", owner_id: "owner-2", calcom_event_type_id: 4343 },
        ],
        board_partner: [
          { board_id: IDS.board, partner_id: IDS.anna, is_lead: true },
          { board_id: IDS.board, partner_id: IDS.bo, is_lead: false },
          { board_id: "board-2", partner_id: IDS.dorte, is_lead: true },
          { board_id: "board-2", partner_id: IDS.bo, is_lead: false },
        ],
      }),
    );
    mocked.db = db2;
    const state = await setPartnerCalcomUserId({}, form(IDS.bo, "99"));
    expect(booking().upserts.map((u) => u.eventTypeId).sort()).toEqual([4242, 4343]);
    expect(state.notice).toMatch(/2 board/);
    expect(db2.tables.board_change).toHaveLength(2);
  });

  it("Cal.com-fejl ruller sædet IKKE tilbage: det står, svaret bærer advarslen, sporet siger 'fejlet'", async () => {
    booking().failWith = new Error("Cal.com svarede 502");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const state = await setPartnerCalcomUserId({}, form(IDS.bo, "99"));

    expect(seatOf(IDS.bo)).toBe(99);
    expect(state.error).toBeUndefined();
    expect(state.warning).toContain(HOSTS_WARNING);
    expect(state.warning).toContain("Cal.com svarede 502");
    expect(db().tables.board_change[0]).toMatchObject({ action: "opdater_hosts", calcom_sync: "fejlet" });
  });

  it("fjernes sædet (tomt felt), gemmes det, og hosts-fejlen vises — et board kan ikke have en vært uden sæde", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const state = await setPartnerCalcomUserId({}, form(IDS.bo, ""));
    expect(seatOf(IDS.bo)).toBeNull();
    expect(state.warning).toContain(HOSTS_WARNING);
    expect(state.warning).toMatch(/Bo/);
    expect(booking().upserts).toEqual([]);
  });

  it("uændret sæde: Cal.com røres ikke og intet logges", async () => {
    const state = await setPartnerCalcomUserId({}, form(IDS.bo, "12"));
    expect(state).toEqual({});
    expect(booking().upserts).toEqual([]);
    expect(db().tables.board_change).toEqual([]);
  });

  it("en partner uden board: sædet gemmes, og Cal.com røres ikke", async () => {
    const state = await setPartnerCalcomUserId({}, form(IDS.dorte, "77"));
    expect(seatOf(IDS.dorte)).toBe(77);
    expect(state).toEqual({});
    expect(booking().upserts).toEqual([]);
  });

  it("et board uden event type springes over uden at logge (intet at opdatere endnu)", async () => {
    mocked.db = createFakeDb(
      boardTables({ board: [{ id: IDS.board, name: "[DEMO] Board", owner_id: IDS.owner, calcom_event_type_id: null }] }),
    );
    const state = await setPartnerCalcomUserId({}, form(IDS.bo, "99"));
    expect(state).toEqual({});
    expect(booking().upserts).toEqual([]);
    expect(db().tables.board_change).toEqual([]);
  });
});

describe("setPartnerCalcomUserId — negative cases", () => {
  it("NEGATIV: et sæde et andet katalogmedlem har, afvises uden at røre Cal.com", async () => {
    db().failures["partner_profile.update"] = { message: "duplicate", code: "23505" };
    const state = await setPartnerCalcomUserId({}, form(IDS.bo, "11"));
    expect(state.error).toMatch(/allerede koblet/);
    expect(booking().upserts).toEqual([]);
    expect(db().tables.board_change).toEqual([]);
  });

  it("NEGATIV: ejer, partner og anonym kan ikke ændre et sæde — intet skrives, Cal.com røres ikke", async () => {
    for (const who of [user("ejer"), user("partner"), null]) {
      mocked.user = who;
      const state = await setPartnerCalcomUserId({}, form(IDS.bo, "99"));
      expect(state.error, String(who?.roles)).toBeTruthy();
    }
    expect(seatOf(IDS.bo)).toBe(12);
    expect(booking().upserts).toEqual([]);
    expect(db().tables.board_change).toEqual([]);
  });

  it("NEGATIV: ugyldigt sæde og manglende partner afvises før noget skrives", async () => {
    expect((await setPartnerCalcomUserId({}, form(IDS.bo, "-3"))).error).toMatch(/positivt heltal/);
    expect((await setPartnerCalcomUserId({}, form("", "5"))).error).toMatch(/Partner-id/);
    expect(seatOf(IDS.bo)).toBe(12);
    expect(booking().upserts).toEqual([]);
  });
});
