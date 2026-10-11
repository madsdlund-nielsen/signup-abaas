import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { asPostgres, asUser } from "./helpers";

/**
 * RLS + atomisk engangsindløsning for rating-links (0023, B-21, ADR 0060).
 *
 * Seed (tests/setup/seed.sql): board b0a4d ejes af ejer-A. Partner Én (e0001) er koblet til
 * auth-bruger partner-B og deltager i f0001 (planlagt) og f0002 (afholdt). Ejer-E er fremmed.
 * Ejer-A og Partner Én har allerede hver en møde-vurdering på f0002 (c1c01 / c1c03).
 *
 * To ting testes, og begge er sikkerhedskritiske fordi vejen er auth-fri:
 *   1. Tabellen er usynlig for alle andre end admin, og kan ikke skrives via RLS.
 *   2. `redeem_rating_link` gør linket til ÉNGANGS — også under samtidige indløsninger.
 */
const DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/abaas_test";

const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b",
  adminD: "00000000-0000-0000-0000-00000000000d",
  ejerE: "00000000-0000-0000-0000-00000000000e",
};
const BOARD = "00000000-0000-0000-0000-0000000b0a4d";
const MEETING_HELD = "00000000-0000-0000-0000-0000000f0002";
const MEETING_PLANNED = "00000000-0000-0000-0000-0000000f0001";
const PARTNER_ONE = "00000000-0000-0000-0000-0000000e0001";
const LINK_A = "00000000-0000-4000-8000-0000000a1111";
const LINK_B = "00000000-0000-4000-8000-0000000a2222";

type Q = { query: Client["query"] };

async function addLink(
  client: Q,
  opts: { id: string; meeting?: string; user?: string | null; partner?: string | null; expires?: string },
) {
  await client.query(
    `insert into rating_link (id, meeting_id, rater_user_id, rater_partner_profile_id, expires_at)
     values ($1, $2, $3, $4, ${opts.expires ?? "now() + interval '14 days'"})`,
    [opts.id, opts.meeting ?? MEETING_HELD, opts.user === undefined ? null : opts.user, opts.partner ?? null],
  );
}

async function redeem(client: Q, id: string, score = 4, comment: string | null = null) {
  const res = await client.query("select redeem_rating_link($1, $2::smallint, $3) as rating_id", [id, score, comment]);
  return res.rows[0].rating_id as string | null;
}

async function usedAt(client: Q, id: string): Promise<Date | null> {
  return (await client.query("select used_at from rating_link where id = $1", [id])).rows[0].used_at;
}

describe("rating_link RLS (0023) — kun admin læser", () => {
  async function seedAndCount(sub: string | null): Promise<number> {
    // Rækken indsættes som DB-ejer (RLS omgås), og tælles derefter som rollen — i samme transaktion.
    return asUser(sub, async (client) => {
      await client.query("reset role");
      await addLink(client, { id: LINK_A, user: USER.ejerA });
      await client.query("set local role app_authenticated");
      return (await client.query("select id from rating_link")).rowCount ?? 0;
    });
  }

  it("admin ser linket", async () => {
    expect(await seedAndCount(USER.adminD)).toBe(1);
  });

  it("NEGATIV: ejeren linket tilhører, ser det IKKE — linket bæres af signaturen, ikke af en session", async () => {
    expect(await seedAndCount(USER.ejerA)).toBe(0);
  });

  it("NEGATIV: partner, fremmed ejer og anonym ser intet", async () => {
    for (const sub of [USER.partnerB, USER.ejerE, null]) {
      expect(await seedAndCount(sub), String(sub)).toBe(0);
    }
  });

  it("NEGATIV: hverken ejer, partner eller admin kan skrive via RLS", async () => {
    for (const sub of [USER.ejerA, USER.partnerB, USER.adminD]) {
      await expect(
        asUser(sub, (client) => addLink(client, { id: LINK_A, user: USER.ejerA })),
        String(sub),
      ).rejects.toThrow();
    }
  });

  it("NEGATIV: en bruger kan ikke markere et link brugt eller forlænge det", async () => {
    for (const sub of [USER.ejerA, USER.adminD]) {
      const touched = await asUser(sub, async (client) => {
        await client.query("reset role");
        await addLink(client, { id: LINK_A, user: USER.ejerA });
        await client.query("set local role app_authenticated");
        const res = await client.query(
          "update rating_link set used_at = now(), expires_at = now() + interval '10 years' where id = $1",
          [LINK_A],
        );
        return res.rowCount ?? 0;
      }).catch(() => 0);
      expect(touched, String(sub)).toBe(0);
    }
  });

  it("NEGATIV: app-rollen kan IKKE kalde redeem_rating_link (funktionen er ikke et åbent endpoint)", async () => {
    const canExecute = await asPostgres(async (client) => {
      const res = await client.query(
        "select has_function_privilege('app_authenticated', 'public.redeem_rating_link(uuid, smallint, text)', 'EXECUTE') as v",
      );
      return res.rows[0].v as boolean;
    });
    expect(canExecute).toBe(false);

    await expect(
      asUser(USER.ejerA, async (client) => {
        await client.query("reset role");
        await addLink(client, { id: LINK_A, user: USER.ejerA });
        await client.query("set local role app_authenticated");
        return redeem(client, LINK_A);
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("rating_link schema-mekanik (0023)", () => {
  it("præcis én rater: hverken ingen eller begge er tilladt", async () => {
    await expect(asPostgres((c) => addLink(c, { id: LINK_A, user: null, partner: null }))).rejects.toThrow(
      /rating_link_one_rater/,
    );
    await expect(
      asPostgres((c) => addLink(c, { id: LINK_A, user: USER.ejerA, partner: PARTNER_ONE })),
    ).rejects.toThrow(/rating_link_one_rater/);
  });

  it("højst ét link pr. rater pr. møde (også med null i den anden kolonne)", async () => {
    await expect(
      asPostgres(async (c) => {
        await addLink(c, { id: LINK_A, user: USER.ejerA });
        await addLink(c, { id: LINK_B, user: USER.ejerA });
      }),
    ).rejects.toThrow(/rating_link_unique_per_rater/);
  });

  it("linket følger mødet (cascade) og brugeren (cascade) — sletteflowet", async () => {
    await asPostgres(async (c) => {
      await c.query("insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000acc99', 'slet@example.com')");
      await addLink(c, { id: LINK_A, user: "00000000-0000-0000-0000-0000000acc99" });
      await c.query("delete from app_user where id = '00000000-0000-0000-0000-0000000acc99'");
      expect((await c.query("select 1 from rating_link where id = $1", [LINK_A])).rowCount).toBe(0);

      await addLink(c, { id: LINK_B, user: USER.ejerA });
      await c.query("delete from meeting where id = $1", [MEETING_HELD]);
      expect((await c.query("select 1 from rating_link where id = $1", [LINK_B])).rowCount).toBe(0);
    });
  });

  it("udløbstid har INGEN default i basen (levetiden er et ejer-spørgsmål)", async () => {
    await expect(
      asPostgres((c) => c.query("insert into rating_link (meeting_id, rater_user_id) values ($1, $2)", [MEETING_HELD, USER.ejerA])),
    ).rejects.toThrow(/expires_at/);
  });
});

describe("redeem_rating_link (0023) — atomisk engangsbrug", () => {
  it("indløser: markerer linket brugt og gemmer vurderingen som møde-vurdering (subject = null)", async () => {
    await asPostgres(async (c) => {
      // Fremmed møde uden eksisterende vurdering, så vi ser en NY række.
      await c.query("delete from meeting_rating where meeting_id = $1", [MEETING_HELD]);
      await addLink(c, { id: LINK_A, user: USER.ejerA });

      const ratingId = await redeem(c, LINK_A, 4, "  Godt møde  ");
      expect(ratingId).not.toBeNull();
      expect(await usedAt(c, LINK_A)).not.toBeNull();

      const rating = (await c.query("select * from meeting_rating where id = $1", [ratingId])).rows[0];
      expect(rating).toMatchObject({
        meeting_id: MEETING_HELD,
        rater_user_id: USER.ejerA,
        rater_partner_profile_id: null,
        subject_partner_profile_id: null,
        score: 4,
        comment: "Godt møde",
      });
    });
  });

  it("en tom kommentar via linket sletter ALDRIG en eksisterende login-kommentar — kun scoren opdateres", async () => {
    await asPostgres(async (c) => {
      await c.query("delete from meeting_rating where meeting_id = $1", [MEETING_HELD]);
      await c.query(
        `insert into meeting_rating (meeting_id, rater_user_id, subject_partner_profile_id, score, comment)
         values ($1, $2, null, 2, 'Skrevet ved login')`,
        [MEETING_HELD, USER.ejerA],
      );
      await addLink(c, { id: LINK_A, user: USER.ejerA });

      const ratingId = await redeem(c, LINK_A, 5, "   ");
      const rating = (await c.query("select score, comment from meeting_rating where id = $1", [ratingId])).rows[0];
      expect(rating).toEqual({ score: 5, comment: "Skrevet ved login" });
    });
  });

  it("en partner-rater gemmes som katalogpost, ikke som bruger", async () => {
    await asPostgres(async (c) => {
      await c.query("delete from meeting_rating where meeting_id = $1", [MEETING_HELD]);
      await addLink(c, { id: LINK_A, partner: PARTNER_ONE });
      const ratingId = await redeem(c, LINK_A, 5);
      const rating = (await c.query("select * from meeting_rating where id = $1", [ratingId])).rows[0];
      expect(rating).toMatchObject({ rater_user_id: null, rater_partner_profile_id: PARTNER_ONE, score: 5, comment: null });
    });
  });

  it("DOBBELTINDLØSNING: det andet kald returnerer null og ændrer ingenting", async () => {
    await asPostgres(async (c) => {
      await c.query("delete from meeting_rating where meeting_id = $1", [MEETING_HELD]);
      await addLink(c, { id: LINK_A, user: USER.ejerA });

      expect(await redeem(c, LINK_A, 5)).not.toBeNull();
      const firstUsedAt = await usedAt(c, LINK_A);
      expect(await redeem(c, LINK_A, 1, "overskriv")).toBeNull();

      expect(await usedAt(c, LINK_A)).toEqual(firstUsedAt);
      const rows = (await c.query("select score, comment from meeting_rating where meeting_id = $1", [MEETING_HELD])).rows;
      expect(rows).toEqual([{ score: 5, comment: null }]);
    });
  });

  it("UDLØBET link afvises og gemmer intet", async () => {
    await asPostgres(async (c) => {
      const before = (await c.query("select count(*)::int as n from meeting_rating")).rows[0].n;
      await c.query(
        `insert into rating_link (id, meeting_id, rater_user_id, expires_at, created_at)
         values ($1, $2, $3, now() - interval '1 second', now() - interval '1 day')`,
        [LINK_A, MEETING_HELD, USER.ejerA],
      );
      expect(await redeem(c, LINK_A)).toBeNull();
      expect(await usedAt(c, LINK_A)).toBeNull();
      expect((await c.query("select count(*)::int as n from meeting_rating")).rows[0].n).toBe(before);
    });
  });

  it("et møde der ikke er afholdt kan ikke vurderes, og linket brændes ikke", async () => {
    await asPostgres(async (c) => {
      await addLink(c, { id: LINK_A, meeting: MEETING_PLANNED, user: USER.ejerA });
      expect(await redeem(c, LINK_A)).toBeNull();
      expect(await usedAt(c, LINK_A)).toBeNull();
    });
  });

  it("raten skal stadig være berettiget: fremmed ejer / partner der ikke deltog afvises", async () => {
    await asPostgres(async (c) => {
      await addLink(c, { id: LINK_A, user: USER.ejerE }); // ejer E ejer ikke boardet
      expect(await redeem(c, LINK_A)).toBeNull();
      expect(await usedAt(c, LINK_A)).toBeNull();

      // Partner Én deltager i f0002 — men fjernes fra mødet efter udstedelsen.
      await addLink(c, { id: LINK_B, partner: PARTNER_ONE });
      await c.query("delete from meeting_partner where meeting_id = $1 and partner_profile_id = $2", [MEETING_HELD, PARTNER_ONE]);
      expect(await redeem(c, LINK_B)).toBeNull();
      expect(await usedAt(c, LINK_B)).toBeNull();
    });
  });

  it("ukendt link-id giver null", async () => {
    await asPostgres(async (c) => {
      expect(await redeem(c, "00000000-0000-4000-8000-00000000dead")).toBeNull();
    });
  });

  it("en ugyldig score ruller HELE indløsningen tilbage — linket brændes ikke uden en vurdering", async () => {
    await asPostgres(async (c) => {
      await addLink(c, { id: LINK_A, user: USER.ejerA });
      await c.query("savepoint før_indløsning");
      await expect(redeem(c, LINK_A, 9)).rejects.toThrow(/score|check/i);
      await c.query("rollback to savepoint før_indløsning");
      expect(await usedAt(c, LINK_A)).toBeNull();
    });
  });

  it("opdaterer en eksisterende møde-vurdering fra samme rater frem for at lave en dublet", async () => {
    await asPostgres(async (c) => {
      // Seed: ejer-A har allerede c1c01 (5, 'Godt møde') på f0002.
      await addLink(c, { id: LINK_A, user: USER.ejerA });
      const ratingId = await redeem(c, LINK_A, 2, "Alligevel ikke");
      expect(ratingId).toBe("00000000-0000-0000-0000-0000000c1c01");
      const rows = (
        await c.query(
          "select score, comment from meeting_rating where meeting_id = $1 and rater_user_id = $2 and subject_partner_profile_id is null",
          [MEETING_HELD, USER.ejerA],
        )
      ).rows;
      expect(rows).toEqual([{ score: 2, comment: "Alligevel ikke" }]);
    });
  });

  it("rører ikke vurderinger af de enkelte rådgivere (subject sat)", async () => {
    await asPostgres(async (c) => {
      await addLink(c, { id: LINK_A, user: USER.ejerA });
      await redeem(c, LINK_A, 1);
      const perPartner = (
        await c.query("select score from meeting_rating where id = '00000000-0000-0000-0000-0000000c1c02'")
      ).rows[0];
      expect(perPartner.score).toBe(4);
    });
  });
});

describe("redeem_rating_link (0023) — SAMTIDIGHED på rigtige forbindelser", () => {
  // Her skal data committes, for to forbindelser ser ikke hinandens uncommittede rækker. Vi
  // bruger et eget møde (og rydder det efter os via cascade), så seed-data og andre testfiler
  // aldrig røres.
  const MEETING_RACE = "00000000-0000-0000-0000-0000000ace01";

  async function connect(): Promise<Client> {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    return client;
  }

  async function setUp(admin: Client) {
    await admin.query("insert into meeting (id, board_id, starts_at, status) values ($1, $2, '2026-07-02T10:00:00Z', 'afholdt')", [
      MEETING_RACE,
      BOARD,
    ]);
    await admin.query("insert into rating_link (id, meeting_id, rater_user_id, expires_at) values ($1, $2, $3, now() + interval '1 day')", [
      LINK_A,
      MEETING_RACE,
      USER.ejerA,
    ]);
  }

  async function cleanUp(admin: Client) {
    await admin.query("delete from meeting where id = $1", [MEETING_RACE]); // cascade: link + vurdering
  }

  it("to indløsninger på samme tid: præcis én lykkes, og der gemmes præcis én vurdering", async () => {
    const [admin, one, two] = await Promise.all([connect(), connect(), connect()]);
    try {
      await setUp(admin);

      // Forbindelse 1 holder rækkelåsen (uncommittet) …
      await one.query("begin");
      const first = await redeem(one, LINK_A, 5, "første");
      expect(first).not.toBeNull();

      // … mens forbindelse 2 forsøger at indløse SAMME link. Den må vente på låsen.
      const secondPending = redeem(two, LINK_A, 1, "anden");
      let settled = false;
      void secondPending.then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled, "den anden indløsning skal vente på den første").toBe(false);

      await one.query("commit");
      expect(await secondPending).toBeNull(); // genvurderer WHERE efter commit: used_at er sat

      const ratings = (await admin.query("select score, comment from meeting_rating where meeting_id = $1", [MEETING_RACE])).rows;
      expect(ratings).toEqual([{ score: 5, comment: "første" }]);
      expect(await usedAt(admin, LINK_A)).not.toBeNull();
    } finally {
      await cleanUp(admin).catch(() => undefined);
      await Promise.all([admin.end(), one.end(), two.end()]);
    }
  });

  it("mange samtidige indløsninger uden eksplicit låsning: kun én vinder", async () => {
    const admin = await connect();
    const clients = await Promise.all(Array.from({ length: 8 }, connect));
    try {
      await setUp(admin);
      const results = await Promise.all(clients.map((client, i) => redeem(client, LINK_A, (i % 5) + 1)));

      expect(results.filter((r) => r !== null)).toHaveLength(1);
      const count = (await admin.query("select count(*)::int as n from meeting_rating where meeting_id = $1", [MEETING_RACE])).rows[0].n;
      expect(count).toBe(1);
    } finally {
      await cleanUp(admin).catch(() => undefined);
      await Promise.all([admin.end(), ...clients.map((c) => c.end())]);
    }
  });
});
