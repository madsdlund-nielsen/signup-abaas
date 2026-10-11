import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { asPostgres, asUser } from "./helpers";

/**
 * RLS og viewen for partner-honorar (0017, ADR 0051).
 *
 * Kernekravet fra fase-5-DoD: en partner må kun se eget honorar — positiv OG negativ case.
 * Den svære negative case er medpartneren på SAMME board: meeting_partner's RLS lader en partner
 * se alle deltagere på sit board, så det er viewens eksplicitte filter (ikke tabel-RLS alene) der
 * holder en medpartners linje ude.
 *
 * Seed (tests/setup/seed.sql): Partner Én (e0001, koblet til partner-B) deltager i mødet
 * f0001 (planlagt) og f0002 (afholdt) på A's board. INGEN fee_rule i seed — tal er ejer-
 * uafklarede, så testene indsætter egne rækker med åbenlyst syntetiske værdier i transaktioner
 * der rulles tilbage (stub-politik).
 *
 * Fixture pr. test (rulles tilbage):
 *  - Partner Tre (e0003) kobles til partner-C og sættes på A's board + begge møder = MEDPARTNER.
 *  - Ejer-E får eget board med Partner Fire (e0004) og et møde = FREMMED board.
 */
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b", // = Partner Én
  partnerC: "00000000-0000-0000-0000-00000000000c", // = Partner Tre efter fixture
  adminD: "00000000-0000-0000-0000-00000000000d",
  ejerE: "00000000-0000-0000-0000-00000000000e",
};
const PARTNER = {
  en: "00000000-0000-0000-0000-0000000e0001",
  tre: "00000000-0000-0000-0000-0000000e0003",
  fire: "00000000-0000-0000-0000-0000000e0004",
};
const BOARD_A = "00000000-0000-0000-0000-0000000b0a4d";
const BOARD_E = "00000000-0000-0000-0000-0000000b0e4d";
const MEETING = {
  planlagt: "00000000-0000-0000-0000-0000000f0001",
  afholdt: "00000000-0000-0000-0000-0000000f0002",
  fremmed: "00000000-0000-0000-0000-0000000f0003",
};

/** Kør fn med fixture indsat (som superuser). Alt rulles tilbage. */
async function withFixture<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  return asPostgres(async (client) => {
    await client.query(`update partner_profile set app_user_id = '${USER.partnerC}' where id = '${PARTNER.tre}'`);
    await client.query(`insert into board_partner (board_id, partner_id) values ('${BOARD_A}', '${PARTNER.tre}')`);
    await client.query(
      `insert into meeting_partner (meeting_id, partner_profile_id, registered_status) values
         ('${MEETING.planlagt}', '${PARTNER.tre}', null),
         ('${MEETING.afholdt}', '${PARTNER.tre}', 'afholdt')`,
    );
    await client.query(`insert into board (id, owner_id, name) values ('${BOARD_E}', '${USER.ejerE}', 'E''s board')`);
    await client.query(`insert into board_partner (board_id, partner_id) values ('${BOARD_E}', '${PARTNER.fire}')`);
    await client.query(
      `insert into meeting (id, board_id, starts_at, status) values ('${MEETING.fremmed}', '${BOARD_E}', '2026-07-02T10:00:00Z', 'afholdt')`,
    );
    await client.query(
      `insert into meeting_partner (meeting_id, partner_profile_id, registered_status)
       values ('${MEETING.fremmed}', '${PARTNER.fire}', 'afholdt')`,
    );
    return fn(client);
  });
}

/** Læs `sql` med RLS som den givne bruger inde i en åben (superuser-)transaktion. */
async function readAs(client: Client, sub: string | null, sql: string): Promise<Array<Record<string, unknown>>> {
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? ""]);
  await client.query("set local role app_authenticated");
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.query("reset role");
  }
}

const LINES = "select meeting_id, partner_profile_id, partner_name from partner_fee_line";

describe("partner_fee_line (0017) — en partner ser kun eget honorar", () => {
  it("POSITIV: partner-B ser sine egne to linjer (planlagt + afholdt møde)", async () => {
    await withFixture(async (client) => {
      const rows = await readAs(client, USER.partnerB, LINES);
      expect(rows.map((r) => r.partner_profile_id)).toEqual([PARTNER.en, PARTNER.en]);
      expect(new Set(rows.map((r) => r.meeting_id))).toEqual(new Set([MEETING.planlagt, MEETING.afholdt]));
    });
  });

  it("POSITIV: medpartneren (partner-C) ser sine egne linjer", async () => {
    await withFixture(async (client) => {
      const rows = await readAs(client, USER.partnerC, LINES);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.partner_profile_id === PARTNER.tre)).toBe(true);
    });
  });

  it("NEGATIV: partner-B ser IKKE medpartnerens linjer på samme møder", async () => {
    await withFixture(async (client) => {
      // Forudsætningen: partner-B KAN se medpartnerens deltagerrække i selve tabellen —
      // det er derfor viewens filter er nødvendigt og ikke blot pynt.
      const raw = await readAs(
        client,
        USER.partnerB,
        `select partner_profile_id from meeting_partner where partner_profile_id = '${PARTNER.tre}'`,
      );
      expect(raw.length).toBeGreaterThan(0);

      const viaView = await readAs(client, USER.partnerB, `${LINES} where partner_profile_id = '${PARTNER.tre}'`);
      expect(viaView).toEqual([]);
    });
  });

  it("NEGATIV: ingen partner ser noget fra et fremmed board", async () => {
    await withFixture(async (client) => {
      for (const sub of [USER.partnerB, USER.partnerC]) {
        const rows = await readAs(client, sub, `${LINES} where meeting_id = '${MEETING.fremmed}'`);
        expect(rows).toEqual([]);
      }
    });
  });

  it("NEGATIV: ejeren ser ingen honorarlinjer — heller ikke på sit eget boards møder", async () => {
    await withFixture(async (client) => {
      expect(await readAs(client, USER.ejerA, LINES)).toEqual([]);
      expect(await readAs(client, USER.ejerE, LINES)).toEqual([]);
    });
  });

  it("NEGATIV: anonym (ingen session) ser intet", async () => {
    await withFixture(async (client) => {
      expect(await readAs(client, null, LINES)).toEqual([]);
    });
  });

  it("admin ser alle partneres linjer: 2 (Én) + 2 (Tre) + 1 (Fire)", async () => {
    await withFixture(async (client) => {
      const rows = await readAs(client, USER.adminD, LINES);
      expect(rows).toHaveLength(5);
      expect(new Set(rows.map((r) => r.partner_profile_id))).toEqual(
        new Set([PARTNER.en, PARTNER.tre, PARTNER.fire]),
      );
    });
  });

  it("viewen er security_invoker: den læser med kalderens rettigheder, ikke ejerens", async () => {
    await asPostgres(async (client) => {
      const { rows } = await client.query(
        "select reloptions from pg_class where relname = 'partner_fee_line'",
      );
      expect(rows[0]?.reloptions).toContain("security_invoker=true");
    });
  });

  it("viewen indeholder grundlaget men INGEN beløb eller satser", async () => {
    await asPostgres(async (client) => {
      const { rows } = await client.query(
        "select column_name from information_schema.columns where table_name = 'partner_fee_line' order by ordinal_position",
      );
      const columns = rows.map((r) => r.column_name as string);
      expect(columns).toEqual(
        expect.arrayContaining(["meeting_id", "partner_profile_id", "starts_at", "duration_minutes", "prep_minutes", "registered_status"]),
      );
      expect(columns.filter((c) => /amount|rate|sats|beloeb/.test(c))).toEqual([]);
    });
  });

  it("NEGATIV: viewen kan ikke skrives gennem (ingen insert/update/delete som app-rolle)", async () => {
    await withFixture(async (client) => {
      await client.query(`select set_config('request.jwt.claim.sub', '${USER.partnerB}', true)`);
      await client.query("set local role app_authenticated");
      // Én statement pr. savepoint, så en afvist forespørgsel ikke afbryder transaktionen.
      for (const statement of [
        `update partner_fee_line set registered_status = 'afholdt' where meeting_id = '${MEETING.planlagt}'`,
        `delete from partner_fee_line where meeting_id = '${MEETING.planlagt}'`,
      ]) {
        await client.query("savepoint s");
        let changed = 0;
        try {
          changed = (await client.query(statement)).rowCount ?? 0;
        } catch {
          changed = 0;
        }
        await client.query("rollback to savepoint s");
        expect(changed).toBe(0);
      }
    });
  });
});

describe("fee_rule (0017) — admin og partnere læser, ingen skriver via RLS", () => {
  const RULE = `insert into fee_rule (version, hourly_rate_minor, effective_from)
                values (1, 100, '2026-01-01T00:00:00Z'), (2, 200, '2026-06-01T00:00:00Z')`;

  async function withRules<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    return asPostgres(async (client) => {
      await client.query(RULE);
      return fn(client);
    });
  }

  it("admin og begge partnere ser alle versioner", async () => {
    await withRules(async (client) => {
      for (const sub of [USER.adminD, USER.partnerB, USER.partnerC]) {
        expect(await readAs(client, sub, "select version from fee_rule")).toHaveLength(2);
      }
    });
  });

  it("NEGATIV: ejere og anonyme ser ingen honorarregler", async () => {
    await withRules(async (client) => {
      for (const sub of [USER.ejerA, USER.ejerE, null]) {
        expect(await readAs(client, sub, "select version from fee_rule")).toEqual([]);
      }
    });
  });

  it("NEGATIV: hverken admin eller partner kan skrive fee_rule via RLS (kun service-role)", async () => {
    for (const sub of [USER.adminD, USER.partnerB, USER.ejerA]) {
      await expect(
        asUser(sub, (client) =>
          client.query(
            `insert into fee_rule (version, hourly_rate_minor, effective_from) values (9, 1, '2030-01-01T00:00:00Z')`,
          ),
        ),
      ).rejects.toThrow(/row-level security|permission denied/i);
    }
  });

  it("NEGATIV: update og delete rammer 0 rækker for app-rollen (ingen write-policies)", async () => {
    await withRules(async (client) => {
      await client.query(`select set_config('request.jwt.claim.sub', '${USER.adminD}', true)`);
      await client.query("set local role app_authenticated");
      const updated = await client.query("update fee_rule set hourly_rate_minor = 999999");
      const deleted = await client.query("delete from fee_rule");
      await client.query("reset role");
      expect(updated.rowCount).toBe(0);
      expect(deleted.rowCount).toBe(0);
      const { rows } = await client.query("select count(*)::int as n, max(hourly_rate_minor) as sats from fee_rule");
      expect(rows[0]).toEqual({ n: 2, sats: 200 });
    });
  });
});

describe("fee_rule (0017) — skema og invarianter", () => {
  it("moms og afbudsregel er 'ikke_fastlagt' som default; satsen har ingen default", async () => {
    await asPostgres(async (client) => {
      const { rows } = await client.query(
        `insert into fee_rule (version, hourly_rate_minor, effective_from)
         values (1, 100, '2026-01-01T00:00:00Z') returning vat_mode, absence_rule, currency`,
      );
      expect(rows[0]).toEqual({ vat_mode: "ikke_fastlagt", absence_rule: "ikke_fastlagt", currency: "DKK" });

      await expect(
        client.query(`insert into fee_rule (version, effective_from) values (2, '2026-02-01T00:00:00Z')`),
      ).rejects.toThrow(/null value|not-null/i);
    });
  });

  it("seed'et indeholder INGEN honorarregel — tal er ejer-territorium", async () => {
    await asPostgres(async (client) => {
      const { rows } = await client.query("select count(*)::int as n from fee_rule");
      expect(rows[0]?.n).toBe(0);
    });
  });

  it("version er unik", async () => {
    await asPostgres(async (client) => {
      await client.query(`insert into fee_rule (version, hourly_rate_minor, effective_from) values (1, 1, '2026-01-01T00:00:00Z')`);
      await expect(
        client.query(`insert into fee_rule (version, hourly_rate_minor, effective_from) values (1, 1, '2026-02-01T00:00:00Z')`),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });

  it("effective_from er unik — to versioner kan ikke være gældende på samme tidspunkt", async () => {
    await asPostgres(async (client) => {
      await client.query(`insert into fee_rule (version, hourly_rate_minor, effective_from) values (1, 1, '2026-01-01T00:00:00Z')`);
      await expect(
        client.query(`insert into fee_rule (version, hourly_rate_minor, effective_from) values (2, 2, '2026-01-01T00:00:00Z')`),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });

  it("satsen kan ikke være negativ, og enum-værdierne er lukkede", async () => {
    await asPostgres(async (client) => {
      await expect(
        client.query(`insert into fee_rule (version, hourly_rate_minor, effective_from) values (1, -1, '2026-01-01T00:00:00Z')`),
      ).rejects.toThrow(/check constraint|violates/i);
    });
    await asPostgres(async (client) => {
      await expect(
        client.query(
          `insert into fee_rule (version, hourly_rate_minor, vat_mode, effective_from) values (1, 1, 'femogtyve', '2026-01-01T00:00:00Z')`,
        ),
      ).rejects.toThrow(/invalid input value for enum/i);
    });
    await asPostgres(async (client) => {
      await expect(
        client.query(
          `insert into fee_rule (version, hourly_rate_minor, absence_rule, effective_from) values (1, 1, 'halvt', '2026-01-01T00:00:00Z')`,
        ),
      ).rejects.toThrow(/invalid input value for enum/i);
    });
  });

  it("sats 0 er tilladt (en beslutning, ikke en manglende værdi)", async () => {
    await asPostgres(async (client) => {
      const { rowCount } = await client.query(
        `insert into fee_rule (version, hourly_rate_minor, effective_from) values (1, 0, '2026-01-01T00:00:00Z')`,
      );
      expect(rowCount).toBe(1);
    });
  });
});
