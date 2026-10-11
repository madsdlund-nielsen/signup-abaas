import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { MAX_BOARD_SIZE, MIN_BOARD_SIZE } from "@/server/matching/algorithm";
import { asPostgres, asUser, DB_URL } from "./helpers";

/**
 * `change_board_composition` (0026, B-66, ADR 0064): sammensætningen som ÉN transaktion. Kernekrav:
 *   - alt eller intet — et fejlende trin efterlader boardet (og sporet) uændret,
 *   - funktionen er sidste værn for invarianterne (2-3 partnere, ≥1 intern, præcis én lead og den er intern),
 *   - samtidige ændringer serialiseres på boardets rækkelås, og en forældet plan afvises,
 *   - revisionsrækken skrives i samme transaktion,
 *   - ingen klientrolle kan kalde den (revoke) — kun service-role.
 *
 * Seed: A's board har kun Partner Én (intern, lead). To = ekstern, Tre = intern, Fire = ekstern.
 */
const BOARD = "00000000-0000-0000-0000-0000000b0a4d";
const ADMIN = "00000000-0000-0000-0000-00000000000d";
const EJER_A = "00000000-0000-0000-0000-00000000000a";
const P1 = "00000000-0000-0000-0000-0000000e0001"; // intern, lead
const P2 = "00000000-0000-0000-0000-0000000e0002"; // ekstern
const P3 = "00000000-0000-0000-0000-0000000e0003"; // intern
const P4 = "00000000-0000-0000-0000-0000000e0004"; // ekstern

interface Call {
  expected: string[];
  add?: string[];
  remove?: string[];
  lead: string | null;
  actorRole?: string;
  action?: string;
  partner?: string | null;
  replaced?: string | null;
  board?: string;
}

const CALL_SQL = `select change_board_composition(
  $1, $2::uuid[], $3::uuid[], $4::uuid[], $5, $6, $7, $8, $9, $10
) as id`;

function params(c: Call): unknown[] {
  return [
    c.board ?? BOARD,
    c.expected,
    c.add ?? [],
    c.remove ?? [],
    c.lead,
    ADMIN,
    c.actorRole ?? "admin",
    c.action ?? "tilfoej",
    c.partner === undefined ? (c.add?.[0] ?? null) : c.partner,
    c.replaced ?? null,
  ];
}

function call(client: Client, c: Call) {
  return client.query(CALL_SQL, params(c));
}

/** Kald der forventes afvist; i en omsluttende transaktion skal fejlen fanges med et savepoint. */
async function rejected(client: Client, c: Call): Promise<{ message: string; code?: string }> {
  await client.query("savepoint attempt");
  try {
    await call(client, c);
  } catch (e) {
    await client.query("rollback to savepoint attempt");
    return e as { message: string; code?: string };
  }
  throw new Error("Funktionen burde have afvist kaldet");
}

async function members(client: Client): Promise<Array<{ partner_id: string; is_lead: boolean }>> {
  const { rows } = await client.query(
    "select partner_id, is_lead from board_partner where board_id = $1 order by partner_id",
    [BOARD],
  );
  return rows;
}

/** Gør boardet til [P1 (lead), P3] — en gyldig base at ændre ud fra. */
async function withTwo(client: Client): Promise<void> {
  await call(client, { expected: [P1], add: [P3], lead: P1 });
}

describe("change_board_composition — den gyldige vej", () => {
  it("tilføj: indsætter, beholder lead og skriver revisionsrækken i samme kald", async () => {
    await asPostgres(async (client) => {
      const { rows } = await call(client, { expected: [P1], add: [P3], lead: P1 });
      expect(await members(client)).toEqual([
        { partner_id: P1, is_lead: true },
        { partner_id: P3, is_lead: false },
      ]);
      const trail = await client.query("select * from board_change where id = $1", [rows[0].id]);
      expect(trail.rows).toHaveLength(1);
      expect(trail.rows[0]).toMatchObject({
        board_id: BOARD,
        actor_id: ADMIN,
        actor_role: "admin",
        action: "tilfoej",
        partner_id: P3,
        replaced_partner_id: null,
        // Pessimistisk til koden har rettet den efter Cal.com-synkroniseringen (0026).
        calcom_sync: "fejlet",
      });
    });
  });

  it("udskift af lead'en: ny lead flyttes, den udgåede er væk, og sporet bærer begge partnere", async () => {
    await asPostgres(async (client) => {
      await withTwo(client);
      await call(client, {
        expected: [P1, P3],
        add: [P4],
        remove: [P1],
        lead: P3,
        action: "udskift",
        partner: P4,
        replaced: P1,
      });
      expect(await members(client)).toEqual([
        { partner_id: P3, is_lead: true },
        { partner_id: P4, is_lead: false },
      ]);
      const trail = await client.query("select partner_id, replaced_partner_id from board_change where action = 'udskift'");
      expect(trail.rows).toEqual([{ partner_id: P4, replaced_partner_id: P1 }]);
    });
  });

  it("sæt lead: flytter markeringen og er 'sprunget_over' på Cal.com (værterne ændres ikke)", async () => {
    await asPostgres(async (client) => {
      await withTwo(client);
      await call(client, { expected: [P1, P3], lead: P3, action: "saet_lead", partner: P3 });
      expect(await members(client)).toEqual([
        { partner_id: P1, is_lead: false },
        { partner_id: P3, is_lead: true },
      ]);
      const trail = await client.query("select calcom_sync from board_change where action = 'saet_lead'");
      expect(trail.rows).toEqual([{ calcom_sync: "sprunget_over" }]);
    });
  });

  it("et board uden lead (ældre data) får en lead ved ændringen", async () => {
    await asPostgres(async (client) => {
      await client.query("update board_partner set is_lead = false where board_id = $1", [BOARD]);
      await call(client, { expected: [P1], add: [P3], lead: P1 });
      expect((await members(client)).filter((m) => m.is_lead).map((m) => m.partner_id)).toEqual([P1]);
    });
  });
});

describe("change_board_composition — sidste værn for invarianterne", () => {
  it("SQL og TypeScript er enige om grænserne (2-3): fejler hvis den ene side flyttes alene (ADR 0064)", () => {
    // Funktionen hardcoder 2 og 3 (kan ikke importere koden); testene under prøver grænserne i SQL.
    expect([MIN_BOARD_SIZE, MAX_BOARD_SIZE]).toEqual([2, 3]);
  });

  it("NEGATIV: en fjerde partner afvises", async () => {
    await asPostgres(async (client) => {
      await withTwo(client);
      await call(client, { expected: [P1, P3], add: [P2], lead: P1 });
      const error = await rejected(client, { expected: [P1, P2, P3], add: [P4], lead: P1 });
      expect(error.message).toMatch(/2-3 partnere/);
    });
  });

  it("NEGATIV: et board under to partnere afvises", async () => {
    await asPostgres(async (client) => {
      await withTwo(client);
      const error = await rejected(client, { expected: [P1, P3], remove: [P3], lead: P1, action: "fjern", partner: P3 });
      expect(error.message).toMatch(/2-3 partnere/);
    });
  });

  it("NEGATIV: et board uden en intern partner afvises", async () => {
    await asPostgres(async (client) => {
      await withTwo(client);
      const error = await rejected(client, {
        expected: [P1, P3],
        add: [P2, P4],
        remove: [P1, P3],
        lead: P2,
        action: "udskift",
      });
      expect(error.message).toMatch(/mindst én intern/);
    });
  });

  it("NEGATIV: en ekstern lead afvises", async () => {
    await asPostgres(async (client) => {
      await withTwo(client);
      const error = await rejected(client, { expected: [P1, P3], add: [P2], lead: P2 });
      expect(error.message).toMatch(/intern partner kan være lead/);
    });
  });

  it("NEGATIV: ingen lead, og en lead der ikke sidder på boardet, afvises (præcis én lead)", async () => {
    await asPostgres(async (client) => {
      await withTwo(client);
      expect((await rejected(client, { expected: [P1, P3], lead: null, action: "saet_lead" })).message).toMatch(
        /præcis én lead/,
      );
      expect((await rejected(client, { expected: [P1, P3], lead: P4, action: "saet_lead" })).message).toMatch(
        /præcis én lead/,
      );
    });
  });

  it("NEGATIV: dublet, fjernelse af en ikke-medlem og ukendt handling/board afvises", async () => {
    await asPostgres(async (client) => {
      await withTwo(client);
      expect((await rejected(client, { expected: [P1, P3], add: [P3], lead: P1 })).message).toMatch(/allerede/);
      expect(
        (await rejected(client, { expected: [P1, P3], remove: [P4], lead: P1, action: "fjern" })).message,
      ).toMatch(/ikke på boardet/);
      expect(
        (await rejected(client, { expected: [P1, P3], lead: P1, action: "opdater_hosts" })).message,
      ).toMatch(/Ukendt sammensætningshandling/);
      expect(
        (await rejected(client, { expected: [], lead: P1, board: "00000000-0000-0000-0000-00000000dead" })).message,
      ).toMatch(/Board ikke fundet/);
    });
  });

  it("NEGATIV: en forældet plan (andet udgangspunkt end boardets) afvises med 40001 og overskriver intet", async () => {
    await asPostgres(async (client) => {
      await withTwo(client);
      const error = await rejected(client, { expected: [P1], add: [P4], lead: P1 });
      expect(error.code).toBe("40001");
      expect(error.message).toMatch(/ændret af en anden/);
      expect((await members(client)).map((m) => m.partner_id)).toEqual([P1, P3]);
    });
  });

  it("NEGATIV: sporets egne constraints gælder — kun ejer/admin er aktør", async () => {
    await asPostgres(async (client) => {
      const error = await rejected(client, { expected: [P1], add: [P3], lead: P1, actorRole: "partner" });
      expect(error.message).toMatch(/violates check constraint/);
    });
  });
});

describe("change_board_composition — atomicitet", () => {
  /**
   * Forbindelsen er IKKE i en omsluttende transaktion her: de trin der lykkes før det fejlende
   * står kun hvis funktionen selv er atomisk. Alle kald fejler, så intet committes og basen
   * efterlades uændret til de øvrige tests.
   */
  async function onOwnConnection<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  it("et fejlende SIDSTE trin (revisionsrækken) ruller indsæt, slet og lead-flyt tilbage", async () => {
    await onOwnConnection(async (client) => {
      const before = await members(client);
      expect(before).toEqual([{ partner_id: P1, is_lead: true }]);

      // Gyldig plan som board, men aktørrollen bryder sporets check — fejlen kommer EFTER skrivningen.
      await expect(
        call(client, { expected: [P1], add: [P3, P4], remove: [P1], lead: P3, actorRole: "partner", action: "udskift" }),
      ).rejects.toThrow(/violates check constraint/);

      expect(await members(client)).toEqual(before);
      expect((await client.query("select 1 from board_change")).rowCount).toBe(0);
    });
  });

  it("et fejlende FØRSTE skrivetrin (ukendt partner, FK) efterlader heller intet", async () => {
    await onOwnConnection(async (client) => {
      const before = await members(client);
      await expect(
        call(client, { expected: [P1], add: ["00000000-0000-0000-0000-00000000dea1"], lead: P1 }),
      ).rejects.toThrow(/foreign key/);
      expect(await members(client)).toEqual(before);
      expect((await client.query("select 1 from board_change")).rowCount).toBe(0);
    });
  });

  it("samtidige ændringer serialiseres: en anden transaktion venter på boardets rækkelås", async () => {
    const first = new Client({ connectionString: DB_URL });
    const second = new Client({ connectionString: DB_URL });
    await first.connect();
    await second.connect();
    try {
      // Den første holder låsen (ikke committet — rulles tilbage til sidst, så basen er uændret).
      await first.query("begin");
      await call(first, { expected: [P1], add: [P3], lead: P1 });

      await second.query("set lock_timeout = '300ms'");
      await expect(call(second, { expected: [P1], add: [P4], lead: P1 })).rejects.toMatchObject({
        code: "55P03", // lock_not_available: den blev ikke sluppet igennem
      });
    } finally {
      await first.query("rollback").catch(() => undefined);
      await first.end();
      await second.end();
    }
  });
});

describe("change_board_composition — kun service-role", () => {
  it("NEGATIV: hverken app-rollen (authenticated) eller PUBLIC kan eksekvere funktionen", async () => {
    const sig = "public.change_board_composition(uuid, uuid[], uuid[], uuid[], uuid, uuid, text, text, uuid, uuid)";
    await asPostgres(async (client) => {
      const { rows } = await client.query(
        `select has_function_privilege('app_authenticated', $1, 'EXECUTE') as authed,
                has_function_privilege('public', $1, 'EXECUTE') as pub,
                (select prosecdef from pg_proc where oid = $1::regprocedure) as definer`,
        [sig],
      );
      expect(rows[0]).toEqual({ authed: false, pub: false, definer: false });
    });
  });

  it("NEGATIV: hverken en ejer eller admin kan kalde den via klientrollen (rpc)", async () => {
    for (const sub of [EJER_A, ADMIN]) {
      await expect(asUser(sub, (client) => call(client, { expected: [P1], add: [P3], lead: P1 })), `sub=${sub}`).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});
