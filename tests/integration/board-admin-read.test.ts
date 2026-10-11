import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "@/server/auth";
import { getAdminBoardDetail, listAdminBoardOverviews } from "@/server/boards/admin";
import { boardTables, createFakeDb, IDS, type FakeDb } from "./support/board-fakes";

/**
 * Admins læsevej til boards (ADR 0062): overblikket og editorens detalje. Service-role bag
 * requireRole('admin') — læsningen samler ejerens navn (app_user, kun læsbar for brugeren selv i
 * RLS), møder, medlemskab, Cal.com-status og ejerens behov (kun tag-id'er).
 */
const mocked = vi.hoisted(() => ({ db: null as unknown, user: null as unknown }));
vi.mock("@/server/auth/supabase-server", () => ({
  createServiceSupabase: () => (mocked.db as FakeDb).client,
  createServerSupabase: async () => (mocked.db as FakeDb).client,
}));
vi.mock("@/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth")>()),
  getCurrentUser: async () => mocked.user,
}));

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "a",
  SUPABASE_SERVICE_ROLE_KEY: "s",
};

function user(...roles: AuthUser["roles"]): AuthUser {
  return { id: IDS.admin, email: "admin@example.com", roles };
}

function tables() {
  return boardTables({
    app_user: [{ id: IDS.owner, email: "ejer@example.com", display_name: "[DEMO] Ejer" }],
    meeting: [
      { id: "m1", board_id: IDS.board },
      { id: "m2", board_id: IDS.board },
    ],
    membership: [{ board_id: IDS.board, status: "aktiv" }],
    quiz_answer: [{ owner_id: IDS.owner, quiz_option_id: "o1" }],
    quiz_option_competence_tag: [
      { quiz_option_id: "o1", competence_tag_id: "t1" },
      { quiz_option_id: "o1", competence_tag_id: "t2" },
    ],
    partner_profile: [
      {
        id: IDS.anna,
        name: "Anna",
        title: null,
        is_internal: true,
        sort_order: 1,
        calcom_user_id: 11,
        partner_profile_competence_tag: [{ competence_tag_id: "t1" }],
      },
      { id: IDS.bo, name: "Bo", title: null, is_internal: true, sort_order: 2, calcom_user_id: null, partner_profile_competence_tag: [] },
      { id: IDS.carl, name: "Carl", title: null, is_internal: false, sort_order: 3, calcom_user_id: 13, partner_profile_competence_tag: [] },
    ],
    board_change: [
      { id: "c2", board_id: IDS.board, actor_role: "admin", action: "tilfoej", partner_id: IDS.carl, replaced_partner_id: null, calcom_sync: "fejlet", created_at: "2026-10-11T10:00:00Z" },
      { id: "c1", board_id: IDS.board, actor_role: "ejer", action: "udskift", partner_id: IDS.bo, replaced_partner_id: IDS.carl, calcom_sync: "opdateret", created_at: "2026-10-10T10:00:00Z" },
    ],
  });
}

beforeEach(() => {
  mocked.db = createFakeDb(tables());
  mocked.user = user("admin");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listAdminBoardOverviews", () => {
  it("uden Supabase-konfiguration giver den en tom liste (kontofri CI/dev)", async () => {
    await expect(listAdminBoardOverviews({})).resolves.toEqual([]);
  });

  it("samler ejer, medlemmer (lead først), møder, medlemskab og Cal.com-status", async () => {
    const [board] = await listAdminBoardOverviews(ENV);

    expect(board).toMatchObject({
      id: IDS.board,
      ownerLabel: "[DEMO] Ejer",
      ownerEmail: "ejer@example.com",
      meetingCount: 2,
      membershipStatus: "aktiv",
      calcomEventTypeId: 4242,
      hostsOutOfSync: true,
    });
    expect(board?.members.map((m) => [m.name, m.isInternal, m.isLead, m.hasCalcomUser])).toEqual([
      ["Anna", true, true, true],
      ["Bo", true, false, false],
    ]);
  });

  it("NEGATIV: ejer, partner og anonym afvises, og intet læses", async () => {
    for (const who of [user("ejer"), user("partner"), user("lead_partner"), null]) {
      mocked.user = who;
      const fresh = createFakeDb(tables());
      mocked.db = fresh;
      await expect(listAdminBoardOverviews(ENV)).rejects.toThrow(/Adgang nægtet/);
      expect(fresh.touched).toEqual([]);
    }
  });

  it("en læsefejl giver en tom liste og en log, ikke et halvt overblik", async () => {
    (mocked.db as FakeDb).failures["board_partner.select"] = "boom";
    await expect(listAdminBoardOverviews(ENV)).resolves.toEqual([]);
  });
});

describe("getAdminBoardDetail", () => {
  it("giver ejerens behov som tag-id'er, hele puljen og de seneste ændringer nyeste først", async () => {
    const detail = await getAdminBoardDetail(IDS.board, ENV);

    expect(detail?.ownerTagIds).toEqual(["t1", "t2"]);
    expect(detail?.pool.map((p) => p.name)).toEqual(["Anna", "Bo", "Carl"]);
    expect(detail?.changes.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(detail?.changes[0]).toMatchObject({ actorRole: "admin", calcomSync: "fejlet", partnerId: IDS.carl });
  });

  it("et senere vellykket 'opdater hosts' ophæver advarslen", async () => {
    (mocked.db as FakeDb).tables.board_change.unshift({
      id: "c3",
      board_id: IDS.board,
      actor_role: "admin",
      action: "opdater_hosts",
      partner_id: null,
      replaced_partner_id: null,
      calcom_sync: "opdateret",
      created_at: "2026-10-11T11:00:00Z",
    });
    expect((await getAdminBoardDetail(IDS.board, ENV))?.hostsOutOfSync).toBe(false);
  });

  it("ukendt board → null", async () => {
    await expect(getAdminBoardDetail("findes-ikke", ENV)).resolves.toBeNull();
  });

  it("ejerens behov der ikke kan læses bliver null (≠ 'ingen behov')", async () => {
    (mocked.db as FakeDb).failures["quiz_answer.select"] = "boom";
    expect((await getAdminBoardDetail(IDS.board, ENV))?.ownerTagIds).toBeNull();
  });

  it("NEGATIV: ikke-admin afvises", async () => {
    mocked.user = user("ejer");
    await expect(getAdminBoardDetail(IDS.board, ENV)).rejects.toThrow(/Adgang nægtet/);
  });
});
