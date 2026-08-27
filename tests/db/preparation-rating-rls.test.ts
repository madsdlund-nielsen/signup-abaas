import { describe, expect, it } from "vitest";
import { asPostgres, asUser } from "./helpers";

/**
 * RLS + schema-mekanik for forberedelse og rating (0015, fase 4.1/4.2, ADR 0038).
 *
 * Seed (tests/setup/seed.sql): board b0a4d ejes af ejer-A. Partner Én (e0001) er koblet til
 * auth-bruger partner-B og deltager i begge møder — f0001 (planlagt) og f0002 (afholdt).
 * Partner-C er BEVIDST ukoblet, ejer-E er en fremmed ejer.
 *
 * Tre tabeller med hvert sit synligheds-regime, og det er netop forskellen der testes:
 *   * meeting_agenda_item  DELT   — ejer + partner på boardet + admin
 *   * meeting_prep_note    PRIVAT — kun forfatteren + admin (ejeren er UDE)
 *   * meeting_rating       PRIVAT — kun den der afgav vurderingen + admin
 */
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b",
  partnerC: "00000000-0000-0000-0000-00000000000c",
  adminD: "00000000-0000-0000-0000-00000000000d",
  ejerE: "00000000-0000-0000-0000-00000000000e",
};

const MEETING_HELD = "00000000-0000-0000-0000-0000000f0002";
const MEETING_PLANNED = "00000000-0000-0000-0000-0000000f0001";
const PARTNER_ONE = "00000000-0000-0000-0000-0000000e0001";

function countAs(sub: string | null, sql: string): Promise<number> {
  return asUser(sub, async (client) => (await client.query(sql)).rowCount ?? 0);
}

describe("meeting_agenda_item RLS (0015) — dagsordenen er DELT", () => {
  it("ejer ser sine møders dagsordenspunkter", async () => {
    expect(await countAs(USER.ejerA, "select id from meeting_agenda_item")).toBe(3);
  });

  it("koblet partner på boardet ser dem også — ellers kan han ikke forberede sig", async () => {
    expect(await countAs(USER.partnerB, "select id from meeting_agenda_item")).toBe(3);
  });

  it("admin ser alt", async () => {
    expect(await countAs(USER.adminD, "select id from meeting_agenda_item")).toBe(3);
  });

  it("NEGATIV: fremmed ejer ser ingen", async () => {
    expect(await countAs(USER.ejerE, "select id from meeting_agenda_item")).toBe(0);
  });

  it("NEGATIV: ukoblet partner ser ingen", async () => {
    expect(await countAs(USER.partnerC, "select id from meeting_agenda_item")).toBe(0);
  });

  it("NEGATIV: uden session ses intet", async () => {
    expect(await countAs(null, "select id from meeting_agenda_item")).toBe(0);
  });

  it("NEGATIV: ingen kan skrive via RLS (writes kun via service-role)", async () => {
    for (const sub of [USER.ejerA, USER.partnerB, USER.adminD]) {
      await expect(
        asUser(sub, (client) =>
          client.query(
            `insert into meeting_agenda_item (meeting_id, kind, body)
             values ('${MEETING_PLANNED}', 'dagsorden', 'smuglet ind')`,
          ),
        ),
      ).rejects.toThrow();
    }
  });
});

describe("meeting_prep_note RLS (0015) — forberedelsen er PRIVAT", () => {
  it("forfatteren ser sin egen forberedelse", async () => {
    expect(await countAs(USER.partnerB, "select id from meeting_prep_note")).toBe(1);
  });

  it("admin ser den", async () => {
    expect(await countAs(USER.adminD, "select id from meeting_prep_note")).toBe(1);
  });

  it("NEGATIV: boardets EJER ser den ikke — snævrere end meeting_note med vilje", async () => {
    expect(await countAs(USER.ejerA, "select id from meeting_prep_note")).toBe(0);
  });

  it("NEGATIV: fremmed ejer, ukoblet partner og anonym ser ingen", async () => {
    expect(await countAs(USER.ejerE, "select id from meeting_prep_note")).toBe(0);
    expect(await countAs(USER.partnerC, "select id from meeting_prep_note")).toBe(0);
    expect(await countAs(null, "select id from meeting_prep_note")).toBe(0);
  });

  it("NEGATIV: forfatteren kan ikke selv skrive via RLS", async () => {
    await expect(
      asUser(USER.partnerB, (client) =>
        client.query(
          `insert into meeting_prep_note (meeting_id, partner_profile_id, body)
           values ('${MEETING_HELD}', '${PARTNER_ONE}', 'smuglet ind')`,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("meeting_rating RLS (0015) — vurderinger er PRIVATE for den der afgav dem", () => {
  it("ejer ser de to vurderinger hun selv har afgivet", async () => {
    expect(await countAs(USER.ejerA, "select id from meeting_rating")).toBe(2);
  });

  it("partner ser kun sin egen vurdering af mødet", async () => {
    expect(await countAs(USER.partnerB, "select id from meeting_rating")).toBe(1);
  });

  it("den VURDEREDE partner ser ikke ejerens score af sig — ikke en offentlig score", async () => {
    const visible = await asUser(USER.partnerB, async (client) =>
      (
        await client.query(
          `select id from meeting_rating where subject_partner_profile_id = '${PARTNER_ONE}'`,
        )
      ).rowCount,
    );
    expect(visible).toBe(0);
  });

  it("admin ser alle tre — aggregeringen er en admin-funktion", async () => {
    expect(await countAs(USER.adminD, "select id from meeting_rating")).toBe(3);
  });

  it("NEGATIV: fremmed ejer, ukoblet partner og anonym ser ingen", async () => {
    expect(await countAs(USER.ejerE, "select id from meeting_rating")).toBe(0);
    expect(await countAs(USER.partnerC, "select id from meeting_rating")).toBe(0);
    expect(await countAs(null, "select id from meeting_rating")).toBe(0);
  });

  it("NEGATIV: ingen kan skrive en vurdering via RLS", async () => {
    for (const sub of [USER.ejerA, USER.partnerB, USER.adminD]) {
      await expect(
        asUser(sub, (client) =>
          client.query(
            `insert into meeting_rating (meeting_id, rater_user_id, score)
             values ('${MEETING_HELD}', '${sub}', 5)`,
          ),
        ),
      ).rejects.toThrow();
    }
  });

  it("NEGATIV: ejeren kan ikke opjustere sin egen vurdering via RLS (0 rækker ramt)", async () => {
    const updated = await countAs(
      USER.ejerA,
      `update meeting_rating set score = 1 where id = '00000000-0000-0000-0000-0000000c1c01'
       returning id`,
    );
    expect(updated).toBe(0);
  });
});

describe("meeting_rating — constraints (0015)", () => {
  it("præcis én rater-identitet: begge sat afvises", async () => {
    await expect(
      asPostgres((client) =>
        client.query(
          `insert into meeting_rating (meeting_id, rater_user_id, rater_partner_profile_id, score)
           values ('${MEETING_HELD}', '${USER.ejerA}', '${PARTNER_ONE}', 4)`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("præcis én rater-identitet: ingen sat afvises", async () => {
    await expect(
      asPostgres((client) =>
        client.query(
          `insert into meeting_rating (meeting_id, score) values ('${MEETING_HELD}', 4)`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("score uden for 1-5 afvises", async () => {
    for (const score of [0, 6]) {
      await expect(
        asPostgres((client) =>
          client.query(
            `insert into meeting_rating (meeting_id, rater_user_id, score)
             values ('${MEETING_PLANNED}', '${USER.ejerE}', ${score})`,
          ),
        ),
      ).rejects.toThrow();
    }
  });

  it("nulls not distinct: samme rater kan ikke lægge to møde-vurderinger på samme møde", async () => {
    // subject = null i begge. Uden `nulls not distinct` ville denne indsættelse lykkes,
    // og gentagne indsendelser ville hobe sig op i stedet for at opdatere.
    await expect(
      asPostgres((client) =>
        client.query(
          `insert into meeting_rating (meeting_id, rater_user_id, subject_partner_profile_id, score)
           values ('${MEETING_HELD}', '${USER.ejerA}', null, 3)`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("samme rater KAN vurdere både mødet og en partner på det", async () => {
    // c1c01 (subject null) og c1c02 (subject = Partner Én) findes begge i seed — beviser at
    // unikheden er pr. subjekt, ikke pr. rater.
    const rows = await asPostgres(async (client) =>
      (
        await client.query(
          `select id from meeting_rating
           where meeting_id = '${MEETING_HELD}' and rater_user_id = '${USER.ejerA}'`,
        )
      ).rowCount,
    );
    expect(rows).toBe(2);
  });
});
