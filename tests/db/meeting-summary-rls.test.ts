import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { asPostgres } from "./helpers";

/**
 * RLS + schema-mekanik for meeting_summary (0022, fase 4.4, B-45, ADR 0059).
 *
 * Seed (tests/setup/seed.sql): board b0a4d ejes af ejer-A; det afholdte møde f0002 ligger på
 * det. Partner Én (e0001) er koblet til auth-bruger partner-B og sidder på boardet.
 * Partner-C er ukoblet, ejer-E er en fremmed ejer.
 *
 * Synlighed er RESTRIKTIV (note-synlighed §12 pkt. 16 er ejerens): boardets ejer + admin.
 * Partnere ser IKKE resuméet — heller ikke den der sad i mødet. Reglen boede før i siden.
 *
 * Rækken indsættes som superuser INDE i hver test-transaktion (rulles tilbage), så seed.sql
 * ikke berøres og testene er isolerede.
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

async function insertSummary(client: Client, meetingId = MEETING_HELD): Promise<void> {
  await client.query(
    `insert into meeting_summary (meeting_id, status, summary, action_items, provider, generated_at)
     values ($1, 'klar', '[DEMO] Resumé', '["[DEMO] Punkt"]'::jsonb, 'demo', now())`,
    [meetingId],
  );
}

/** Indsæt som superuser, skift derefter til app-rollen og kør forespørgslen som brugeren. */
function countAs(sub: string | null, sql = "select id from meeting_summary"): Promise<number> {
  return asPostgres(async (client) => {
    await insertSummary(client);
    await client.query("set local role app_authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [sub ?? ""]);
    return (await client.query(sql)).rowCount ?? 0;
  });
}

describe("meeting_summary RLS (0022) — boardets ejer + admin", () => {
  it("ejeren ser sit eget mødes resumé", async () => {
    expect(await countAs(USER.ejerA)).toBe(1);
  });

  it("ejeren kan læse indholdet, ikke bare rækken", async () => {
    const rows = await asPostgres(async (client) => {
      await insertSummary(client);
      await client.query("set local role app_authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [USER.ejerA]);
      return (await client.query("select summary, action_items from meeting_summary")).rows;
    });
    expect(rows).toEqual([{ summary: "[DEMO] Resumé", action_items: ["[DEMO] Punkt"] }]);
  });

  it("admin ser alt", async () => {
    expect(await countAs(USER.adminD)).toBe(1);
  });

  it("NEGATIV: en fremmed ejer ser det ikke", async () => {
    expect(await countAs(USER.ejerE)).toBe(0);
  });

  it("NEGATIV: partneren der sad i mødet (på boardet) ser det ikke — restriktiv default", async () => {
    expect(await countAs(USER.partnerB)).toBe(0);
  });

  it("NEGATIV: en fremmed (ukoblet) partner ser det ikke", async () => {
    expect(await countAs(USER.partnerC)).toBe(0);
  });

  it("NEGATIV: uden session ses intet", async () => {
    expect(await countAs(null)).toBe(0);
  });

  it("NEGATIV: ingen kan skrive via RLS (writes kun via service-role)", async () => {
    for (const sub of [USER.ejerA, USER.partnerB, USER.adminD, USER.ejerE]) {
      await expect(
        asPostgres(async (client) => {
          await client.query("set local role app_authenticated");
          await client.query("select set_config('request.jwt.claim.sub', $1, true)", [sub]);
          await client.query(
            `insert into meeting_summary (meeting_id, status, summary, generated_at)
             values ($1, 'klar', 'smuglet ind', now())`,
            [MEETING_PLANNED],
          );
        }),
      ).rejects.toThrow();
    }
  });

  it("NEGATIV: ejeren kan heller ikke rette sit eget resumé (0 rækker berørt)", async () => {
    const affected = await asPostgres(async (client) => {
      await insertSummary(client);
      await client.query("set local role app_authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [USER.ejerA]);
      return (await client.query("update meeting_summary set summary = 'omskrevet'")).rowCount;
    });
    expect(affected).toBe(0);
  });
});

describe("meeting_summary — schema-mekanik (0022)", () => {
  it("én række pr. møde: unique(meeting_id)", async () => {
    await expect(
      asPostgres(async (client) => {
        await insertSummary(client);
        await insertSummary(client);
      }),
    ).rejects.toThrow(/meeting_summary_meeting_id_key|duplicate key/);
  });

  it("ON CONFLICT DO NOTHING gør oprettelsen idempotent (det kørslen bruger)", async () => {
    const count = await asPostgres(async (client) => {
      for (let i = 0; i < 2; i++) {
        await client.query(
          "insert into meeting_summary (meeting_id) values ($1) on conflict (meeting_id) do nothing",
          [MEETING_HELD],
        );
      }
      return (await client.query("select id from meeting_summary where meeting_id = $1", [MEETING_HELD])).rowCount;
    });
    expect(count).toBe(1);
  });

  it("starter som afventer med 0 forsøg og tomme handlingspunkter", async () => {
    const row = await asPostgres(async (client) => {
      await client.query("insert into meeting_summary (meeting_id) values ($1)", [MEETING_HELD]);
      return (await client.query("select status, attempts, action_items, summary from meeting_summary")).rows[0];
    });
    expect(row).toEqual({ status: "afventer", attempts: 0, action_items: [], summary: null });
  });

  it("NEGATIV: en 'klar' række uden resumé og tidspunkt afvises", async () => {
    await expect(
      asPostgres((client) =>
        client.query("insert into meeting_summary (meeting_id, status) values ($1, 'klar')", [MEETING_HELD]),
      ),
    ).rejects.toThrow(/meeting_summary_klar_has_text/);
  });

  it("NEGATIV: ukendt status, negative forsøg og ikke-array handlingspunkter afvises", async () => {
    await expect(
      asPostgres((client) =>
        client.query("insert into meeting_summary (meeting_id, status) values ($1, 'ukendt')", [MEETING_HELD]),
      ),
    ).rejects.toThrow();
    await expect(
      asPostgres((client) =>
        client.query("insert into meeting_summary (meeting_id, attempts) values ($1, -1)", [MEETING_HELD]),
      ),
    ).rejects.toThrow();
    await expect(
      asPostgres((client) =>
        client.query("insert into meeting_summary (meeting_id, action_items) values ($1, '{}'::jsonb)", [MEETING_HELD]),
      ),
    ).rejects.toThrow(/meeting_summary_action_items_array/);
  });

  it("dataminimering: der er ingen kolonne til det rå transskript", async () => {
    const columns = await asPostgres(async (client) =>
      (
        await client.query(
          "select column_name from information_schema.columns where table_name = 'meeting_summary'",
        )
      ).rows.map((r) => r.column_name as string),
    );
    expect(columns.filter((c) => /transcript|transskript/i.test(c))).toEqual([]);
  });

  it("resuméet slettes med mødet (cascade — GDPR-sletteflowet)", async () => {
    const left = await asPostgres(async (client) => {
      await client.query(
        "insert into meeting (id, board_id, starts_at, status) values ('00000000-0000-0000-0000-0000000f0aaa', '00000000-0000-0000-0000-0000000b0a4d', now(), 'afholdt')",
      );
      await insertSummary(client, "00000000-0000-0000-0000-0000000f0aaa");
      await client.query("delete from meeting where id = '00000000-0000-0000-0000-0000000f0aaa'");
      return (await client.query("select id from meeting_summary")).rowCount;
    });
    expect(left).toBe(0);
  });
});
