import { describe, expect, it } from "vitest";
import { asUser } from "./helpers";

// Seed (tests/setup/seed.sql): published spørgsmål c0001 (+ option c0a01 + tag-map),
// draft spørgsmål c0002 (+ option c0a02 + tag-map). Brugere fra seed.sql.
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  adminD: "00000000-0000-0000-0000-00000000000d",
};

function countAs(sub: string | null, sql: string): Promise<number> {
  return asUser(sub, async (client) => (await client.query(sql)).rowCount ?? 0);
}

describe("quiz RLS (0007) — admin ser alt, ejer ser kun published", () => {
  it("admin ser både published og draft spørgsmål", async () => {
    expect(await countAs(USER.adminD, "select id from quiz_question")).toBe(2);
  });

  it("authed ejer ser kun published spørgsmål", async () => {
    expect(await countAs(USER.ejerA, "select id from quiz_question")).toBe(1);
  });

  it("NEGATIV: ejer ser ikke draft-spørgsmålet", async () => {
    const n = await countAs(
      USER.ejerA,
      "select id from quiz_question where id = '00000000-0000-0000-0000-0000000c0002'",
    );
    expect(n).toBe(0);
  });

  it("NEGATIV: uden session ses ingen spørgsmål", async () => {
    expect(await countAs(null, "select id from quiz_question")).toBe(0);
  });

  it("options: admin ser alle; ejer ser kun options på published spørgsmål", async () => {
    expect(await countAs(USER.adminD, "select id from quiz_option")).toBe(2);
    expect(await countAs(USER.ejerA, "select id from quiz_option")).toBe(1);
  });

  it("tag-mapping: admin ser alle; ejer ser kun mapping for published option", async () => {
    expect(await countAs(USER.adminD, "select quiz_option_id from quiz_option_competence_tag")).toBe(2);
    expect(await countAs(USER.ejerA, "select quiz_option_id from quiz_option_competence_tag")).toBe(1);
  });

  it("NEGATIV: ikke-admin kan ikke indsætte et spørgsmål (ingen write-policy → RLS blokerer)", async () => {
    await expect(
      asUser(USER.ejerA, (client) =>
        client.query("insert into quiz_question (key, prompt, kind) values ('x', 'X', 'single')"),
      ),
    ).rejects.toThrow();
  });

  it("NEGATIV: ikke-admin kan ikke opdatere et spørgsmål (RLS → 0 rækker ramt)", async () => {
    const affected = await asUser(USER.ejerA, async (client) => {
      const res = await client.query(
        "update quiz_question set prompt = 'hack' where key = 'kompetencer'",
      );
      return res.rowCount ?? 0;
    });
    expect(affected).toBe(0);
  });

  it("NEGATIV: ikke-admin kan ikke indsætte en option (ingen write-policy → RLS blokerer)", async () => {
    await expect(
      asUser(USER.ejerA, (client) =>
        client.query(
          "insert into quiz_option (quiz_question_id, label, kind) values ('00000000-0000-0000-0000-0000000c0001', 'X', 'tag')",
        ),
      ),
    ).rejects.toThrow();
  });

  it("NEGATIV: ikke-admin kan ikke opdatere en option (RLS → 0 rækker ramt)", async () => {
    const affected = await asUser(USER.ejerA, async (client) => {
      const res = await client.query(
        "update quiz_option set label = 'hack' where id = '00000000-0000-0000-0000-0000000c0a01'",
      );
      return res.rowCount ?? 0;
    });
    expect(affected).toBe(0);
  });

  it("NEGATIV: ikke-admin kan ikke koble et tag til en option (RLS blokerer join-insert)", async () => {
    await expect(
      asUser(USER.ejerA, (client) =>
        client.query(
          `insert into quiz_option_competence_tag (quiz_option_id, competence_tag_id)
             select '00000000-0000-0000-0000-0000000c0a01', id from competence_tag limit 1`,
        ),
      ),
    ).rejects.toThrow();
  });
});
