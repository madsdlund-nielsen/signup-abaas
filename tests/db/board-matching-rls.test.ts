import { describe, expect, it } from "vitest";
import { asUser } from "./helpers";

/**
 * RLS for board-matching (migration 0010, ADR 0021).
 *
 * To ting dækkes her:
 *   1. board_partner fik ALDRIG slået RLS til i 0002 — enhver authed bruger kunne skrive sig selv
 *      ind på et vilkårligt board. 1.5 er første fase der skriver til tabellen, så hullet lukkes
 *      i 0010; testene nedenfor holder det lukket.
 *   2. Ejeren får en snævert scopet read-policy på kataloget: kun de profiler der sidder på HENDES
 *      board — ikke hele puljen (GDPR, jf. 0009's egen advarsel).
 *
 * Seed: board b0a4d ejes af ejer-A og har præcis én partner (profil e0001). Profil e0002/e0003/e0004
 * er i kataloget men UDEN for boardet → negativ-cases for scopingen.
 */
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b",
  adminD: "00000000-0000-0000-0000-00000000000d",
  ejerE: "00000000-0000-0000-0000-00000000000e",
};
const BOARD = "00000000-0000-0000-0000-0000000b0a4d";
const ON_BOARD = "00000000-0000-0000-0000-0000000e0001";
const OFF_BOARD = "00000000-0000-0000-0000-0000000e0002";

function countAs(sub: string | null, sql: string): Promise<number> {
  return asUser(sub, async (client) => (await client.query(sql)).rowCount ?? 0);
}

describe("board_partner RLS (0010) — hullet fra 0002 er lukket", () => {
  it("ejer ser medlemskaberne på sit eget board", async () => {
    expect(await countAs(USER.ejerA, "select partner_id from board_partner")).toBe(1);
  });

  it("admin ser alle medlemskaber", async () => {
    expect(await countAs(USER.adminD, "select partner_id from board_partner")).toBe(1);
  });

  it("NEGATIV: fremmed ejer ser ingen medlemskaber", async () => {
    expect(await countAs(USER.ejerE, "select partner_id from board_partner")).toBe(0);
  });

  // 0011: partner-B (koblet til e0001 på boardet) ser nu eget boards medlemskaber.
  it("partner på boardet ser eget boards medlemskaber (0011)", async () => {
    expect(await countAs(USER.partnerB, "select partner_id from board_partner")).toBe(1);
  });

  it("NEGATIV: uden session ses intet", async () => {
    expect(await countAs(null, "select partner_id from board_partner")).toBe(0);
  });

  it("NEGATIV: ingen kan skrive sig ind på et board via RLS (writes kun via service-role)", async () => {
    // Præcis det hul 0010 lukker: før migrationen kunne enhver authed bruger indsætte her.
    for (const sub of [USER.ejerA, USER.ejerE, USER.partnerB, USER.adminD]) {
      await expect(
        asUser(sub, (client) =>
          client.query(
            `insert into board_partner (board_id, partner_id) values ('${BOARD}', '${OFF_BOARD}')`,
          ),
        ),
      ).rejects.toThrow();
    }
  });

  it("NEGATIV: en fremmed ejer kan ikke slette medlemskaber på et andet boards", async () => {
    const deleted = await countAs(
      USER.ejerE,
      `delete from board_partner where board_id = '${BOARD}' returning partner_id`,
    );
    expect(deleted).toBe(0);
  });
});

describe("partner_profile ejer-read-policy (0010) — kun eget boards partnere", () => {
  it("ejer ser den katalogpost der sidder på hendes board", async () => {
    expect(await countAs(USER.ejerA, "select id from partner_profile")).toBe(1);
    expect(
      await countAs(USER.ejerA, `select id from partner_profile where id = '${ON_BOARD}'`),
    ).toBe(1);
  });

  it("ejer ser tag-koblingen for sin board-partner", async () => {
    expect(
      await countAs(USER.ejerA, "select partner_profile_id from partner_profile_competence_tag"),
    ).toBe(1);
  });

  it("NEGATIV: ejer ser IKKE resten af puljen (GDPR-scoping)", async () => {
    expect(
      await countAs(USER.ejerA, `select id from partner_profile where id = '${OFF_BOARD}'`),
    ).toBe(0);
  });

  it("NEGATIV: ejer uden board ser intet katalog", async () => {
    expect(await countAs(USER.ejerE, "select id from partner_profile")).toBe(0);
  });

  it("admin ser fortsat hele kataloget", async () => {
    expect(await countAs(USER.adminD, "select id from partner_profile")).toBe(4);
  });
});
