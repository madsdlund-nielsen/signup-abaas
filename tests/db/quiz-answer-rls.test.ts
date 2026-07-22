import { describe, expect, it } from "vitest";
import { asUser } from "./helpers";

// Seed (tests/setup/seed.sql): ejer-A (…000a) har ét svar (option c0a01, published spørgsmål).
// Ejer-E (…000e) har bevidst INGEN svar. c0a02 hører til et DRAFT-spørgsmål.
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  ejerE: "00000000-0000-0000-0000-00000000000e",
  adminD: "00000000-0000-0000-0000-00000000000d",
};
const PUBLISHED_OPTION = "00000000-0000-0000-0000-0000000c0a01";
const DRAFT_OPTION = "00000000-0000-0000-0000-0000000c0a02";

function countAs(sub: string | null, sql: string): Promise<number> {
  return asUser(sub, async (client) => (await client.query(sql)).rowCount ?? 0);
}

describe("quiz_answer RLS (0008) — ejer-skrivbar tabel, kun egne svar", () => {
  it("ejer ser kun egne svar", async () => {
    expect(await countAs(USER.ejerA, "select id from quiz_answer")).toBe(1);
    expect(await countAs(USER.ejerE, "select id from quiz_answer")).toBe(0);
  });

  it("NEGATIV: uden session ses ingen svar", async () => {
    expect(await countAs(null, "select id from quiz_answer")).toBe(0);
  });

  it("admin ser alle svar (read-only til 1.5/AI)", async () => {
    expect(await countAs(USER.adminD, "select id from quiz_answer")).toBe(1);
  });

  it("ejer kan gemme eget svar mod et published spørgsmål", async () => {
    const seen = await asUser(USER.ejerE, async (client) => {
      await client.query(
        `insert into quiz_answer (owner_id, quiz_option_id) values ('${USER.ejerE}', '${PUBLISHED_OPTION}')`,
      );
      return (await client.query("select id from quiz_answer")).rowCount ?? 0;
    });
    expect(seen).toBe(1);
  });

  it("NEGATIV: ejer kan ikke gemme svar for en anden ejer (with-check → auth.uid())", async () => {
    await expect(
      asUser(USER.ejerE, (client) =>
        client.query(
          `insert into quiz_answer (owner_id, quiz_option_id) values ('${USER.ejerA}', '${PUBLISHED_OPTION}')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("NEGATIV: ejer kan ikke svare på et draft-spørgsmål (with-check → is_published)", async () => {
    await expect(
      asUser(USER.ejerE, (client) =>
        client.query(
          `insert into quiz_answer (owner_id, quiz_option_id) values ('${USER.ejerE}', '${DRAFT_OPTION}')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("NEGATIV: ejer kan ikke slette en anden ejers svar (0 rækker ramt)", async () => {
    const affected = await asUser(USER.ejerE, async (client) => {
      const res = await client.query(`delete from quiz_answer where owner_id = '${USER.ejerA}'`);
      return res.rowCount ?? 0;
    });
    expect(affected).toBe(0);
  });
});
