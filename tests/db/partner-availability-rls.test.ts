import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { asPostgres } from "./helpers";

/**
 * RLS + schema-mekanik for partner-tilgængelighed (0018, fase 5.3, ADR 0052).
 *
 * Seed (tests/setup/seed.sql): Partner Én (e0001) er koblet til auth-bruger partner-B og sidder
 * på ejer-A's board. Partner To (e0002) har intet login. Partner-C er en partner UDEN katalogpost,
 * ejer-E er en fremmed ejer.
 *
 * Seed'et indeholder ingen tilgængelighed (det er partnerens egne data), så hver test indsætter
 * sine rækker som DB-ejer i en transaktion der rulles tilbage — og læser derefter med RLS som
 * app-rollen. Rækkerne har åbenlyst syntetiske værdier.
 *
 * Synlighedsreglen der testes: KUN partneren selv + admin. Boardets ejer og boardets øvrige
 * partnere er BEVIDST udeladt (ADR 0052) — fraværsnoten er privat, og ejerens booking-visning
 * beregnes server-side.
 */
const DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/abaas_test";

const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b",
  partnerC: "00000000-0000-0000-0000-00000000000c",
  adminD: "00000000-0000-0000-0000-00000000000d",
  ejerE: "00000000-0000-0000-0000-00000000000e",
};
const PARTNER_ONE = "00000000-0000-0000-0000-0000000e0001";
const PARTNER_TWO = "00000000-0000-0000-0000-0000000e0002";
const BOARD_A = "00000000-0000-0000-0000-0000000b0a4d";

/** Fælles opsætning: Én og To (som boardkollega) har hver et vindue og et fravær. */
const SETUP = `
  insert into board_partner (board_id, partner_id) values ('${BOARD_A}', '${PARTNER_TWO}');
  insert into partner_availability (partner_profile_id, weekday, start_time, end_time) values
    ('${PARTNER_ONE}', 1, '09:00', '12:00'),
    ('${PARTNER_TWO}', 2, '10:00', '14:00');
  insert into partner_absence (partner_profile_id, starts_on, ends_on, note) values
    ('${PARTNER_ONE}', '2026-10-12', '2026-10-14', '[DEMO] privat note'),
    ('${PARTNER_TWO}', '2026-11-02', '2026-11-03', null);
`;

/** Indsæt SETUP som DB-ejer, skift til app-rollen med en given session, kør fn, rul tilbage. */
async function withSetupAs<T>(
  sub: string | null,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(SETUP);
    await client.query("set local role app_authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? ""]);
    const result = await fn(client);
    await client.query("rollback");
    return result;
  } finally {
    await client.end();
  }
}

async function countAs(sub: string | null, table: string): Promise<number> {
  return withSetupAs(sub, async (client) => (await client.query(`select id from ${table}`)).rowCount ?? 0);
}

describe.each(["partner_availability", "partner_absence"])("%s RLS (0018)", (table) => {
  it("partneren ser KUN sine egne rækker — ikke boardkollegaens", async () => {
    // partner-B er Partner Én; Partner To sidder på samme board men er en anden partner.
    expect(await countAs(USER.partnerB, table)).toBe(1);
  });

  it("admin ser alle", async () => {
    expect(await countAs(USER.adminD, table)).toBe(2);
  });

  it("NEGATIV: boardets EJER ser ingen — bevidst, booking-visningen beregnes server-side", async () => {
    expect(await countAs(USER.ejerA, table)).toBe(0);
  });

  it("NEGATIV: fremmed ejer ser ingen", async () => {
    expect(await countAs(USER.ejerE, table)).toBe(0);
  });

  it("NEGATIV: partner uden katalogpost ser ingen", async () => {
    expect(await countAs(USER.partnerC, table)).toBe(0);
  });

  it("NEGATIV: uden session ses intet", async () => {
    expect(await countAs(null, table)).toBe(0);
  });
});

describe("partner_absence — den private note", () => {
  it("partneren kan læse sin egen note", async () => {
    const note = await withSetupAs(USER.partnerB, async (client) => {
      const { rows } = await client.query("select note from partner_absence");
      return (rows[0] as { note: string | null }).note;
    });
    expect(note).toBe("[DEMO] privat note");
  });

  it("NEGATIV: ejeren kan ikke læse noten (0 rækker, ikke en maskeret kolonne)", async () => {
    const rows = await withSetupAs(USER.ejerA, async (client) =>
      (await client.query("select note from partner_absence")).rows,
    );
    expect(rows).toEqual([]);
  });
});

describe.each([
  ["partner_availability", `(partner_profile_id, weekday, start_time, end_time) values ('${PARTNER_ONE}', 3, '09:00', '10:00')`],
  ["partner_absence", `(partner_profile_id, starts_on, ends_on) values ('${PARTNER_ONE}', '2026-12-01', '2026-12-02')`],
])("%s — ingen write-policies (writes kun via service-role)", (table, insertTail) => {
  const actors = [
    ["den berørte partner selv", USER.partnerB],
    ["admin", USER.adminD],
    ["boardets ejer", USER.ejerA],
    ["en fremmed ejer", USER.ejerE],
  ] as const;

  it.each(actors)("NEGATIV: %s kan ikke indsætte", async (_label, sub) => {
    await expect(
      withSetupAs(sub, (client) => client.query(`insert into ${table} ${insertTail}`)),
    ).rejects.toThrow();
  });

  it.each(actors)("NEGATIV: %s kan hverken opdatere eller slette en eksisterende række", async (_label, sub) => {
    const result = await withSetupAs(sub, async (client) => {
      const updated = await client.query(
        table === "partner_availability"
          ? "update partner_availability set end_time = '23:00'"
          : "update partner_absence set ends_on = '2030-01-01'",
      );
      const deleted = await client.query(`delete from ${table}`);
      return [updated.rowCount, deleted.rowCount];
    });
    expect(result).toEqual([0, 0]);
  });
});

describe("partner_availability — schema-mekanik (0018)", () => {
  const insert = (weekday: number, start: string, end: string, partner = PARTNER_ONE) =>
    `insert into partner_availability (partner_profile_id, weekday, start_time, end_time)
     values ('${partner}', ${weekday}, '${start}', '${end}')`;

  it("accepterer et gyldigt vindue — også til midnat (24:00) og søndag (7)", async () => {
    await asPostgres(async (client) => {
      await client.query(insert(7, "22:00", "24:00"));
      const { rows } = await client.query("select count(*)::int as n from partner_availability");
      expect((rows[0] as { n: number }).n).toBe(1);
    });
  });

  it("NEGATIV: ugedag uden for 1-7 afvises", async () => {
    for (const weekday of [0, 8]) {
      await expect(asPostgres((client) => client.query(insert(weekday, "09:00", "10:00")))).rejects.toThrow(
        /weekday|check/,
      );
    }
  });

  it("NEGATIV: slut skal ligge efter start (lig og før afvises)", async () => {
    await expect(asPostgres((client) => client.query(insert(1, "10:00", "10:00")))).rejects.toThrow(
      /partner_availability_end_after_start/,
    );
    await expect(asPostgres((client) => client.query(insert(1, "11:00", "10:00")))).rejects.toThrow(
      /partner_availability_end_after_start/,
    );
  });

  it("NEGATIV: samme vindue to gange afvises; delvist overlappende tillades", async () => {
    await expect(
      asPostgres(async (client) => {
        await client.query(insert(1, "09:00", "12:00"));
        await client.query(insert(1, "09:00", "12:00"));
      }),
    ).rejects.toThrow(/partner_availability_unique_window/);
    await asPostgres(async (client) => {
      await client.query(insert(1, "09:00", "12:00"));
      await client.query(insert(1, "11:00", "14:00"));
    });
  });

  it("NEGATIV: vinduet skal tilhøre en eksisterende partnerprofil", async () => {
    await expect(
      asPostgres((client) =>
        client.query(insert(1, "09:00", "10:00", "00000000-0000-0000-0000-0000000e00ff")),
      ),
    ).rejects.toThrow(/foreign key|violates/);
  });

  it("sletning af partnerprofilen sletter vinduer og fravær med (sletteflow)", async () => {
    await asPostgres(async (client) => {
      await client.query(SETUP);
      await client.query(`delete from board_partner where partner_id = '${PARTNER_TWO}'`);
      await client.query(`delete from partner_profile where id = '${PARTNER_TWO}'`);
      const left = await client.query(
        `select (select count(*) from partner_availability where partner_profile_id = '${PARTNER_TWO}')::int as slots,
                (select count(*) from partner_absence where partner_profile_id = '${PARTNER_TWO}')::int as absences`,
      );
      expect(left.rows[0]).toEqual({ slots: 0, absences: 0 });
    });
  });
});

describe("partner_absence — schema-mekanik (0018)", () => {
  const insert = (from: string, to: string, note = "null") =>
    `insert into partner_absence (partner_profile_id, starts_on, ends_on, note)
     values ('${PARTNER_ONE}', '${from}', '${to}', ${note})`;

  it("accepterer en én-dags periode og en note på præcis 500 tegn", async () => {
    await asPostgres(async (client) => {
      await client.query(insert("2026-10-12", "2026-10-12"));
      await client.query(insert("2026-10-20", "2026-10-21", `'${"x".repeat(500)}'`));
    });
  });

  it("NEGATIV: til-dato før fra-dato afvises", async () => {
    await expect(asPostgres((client) => client.query(insert("2026-10-13", "2026-10-12")))).rejects.toThrow(
      /partner_absence_end_not_before_start/,
    );
  });

  it("NEGATIV: en note over 500 tegn afvises", async () => {
    await expect(
      asPostgres((client) => client.query(insert("2026-10-12", "2026-10-12", `'${"x".repeat(501)}'`))),
    ).rejects.toThrow(/note|check/);
  });
});
