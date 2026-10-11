import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { asPostgres, asUser } from "./helpers";

/**
 * Revisionssporet for boardets sammensætning (0025, ADR 0062). Tabellen starter TOM (ingen række
 * i migration eller seed); rækkerne her indsættes som DB-ejer (≈ service-role) i transaktioner der
 * rulles tilbage. Kernekravene: kun admin læser; ingen skriver via RLS — heller ikke admin;
 * check-constraints afviser ukendte handlinger; sletning af en bruger eller katalogpost efterlader
 * rækken som anonym historik, og sletning af boardet tager den med.
 */
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b",
  adminD: "00000000-0000-0000-0000-00000000000d",
  ejerE: "00000000-0000-0000-0000-00000000000e",
};
const BOARD = "00000000-0000-0000-0000-0000000b0a4d";
const PROFILE_2 = "00000000-0000-0000-0000-0000000e0002";

async function insertChange(
  client: Client,
  opts: { action?: string; sync?: string; actorRole?: string; actor?: string | null } = {},
): Promise<void> {
  const { action = "tilfoej", sync = "opdateret", actorRole = "admin", actor = USER.adminD } = opts;
  await client.query(
    `insert into board_change (board_id, actor_id, actor_role, action, partner_id, calcom_sync)
     values ($1, $2, $3, $4, $5, $6)`,
    [BOARD, actor, actorRole, action, PROFILE_2, sync],
  );
}

describe("board_change starter tom", () => {
  it("der findes ingen rækker efter migration + seed", async () => {
    await asPostgres(async (client) => {
      expect((await client.query("select 1 from board_change")).rowCount).toBe(0);
    });
  });
});

describe("board_change RLS (0025) — kun admin læser", () => {
  it("admin ser rækken; ejeren af boardet, en fremmed ejer, partneren og anonym ser 0", async () => {
    await asPostgres(async (client) => {
      await insertChange(client);
      for (const [sub, expected] of [
        [USER.adminD, 1],
        [USER.ejerA, 0],
        [USER.ejerE, 0],
        [USER.partnerB, 0],
        ["", 0],
      ] as const) {
        await client.query(`select set_config('request.jwt.claim.sub', '${sub}', true)`);
        await client.query("set local role app_authenticated");
        const result = await client.query("select id from board_change");
        expect(result.rowCount, `sub=${sub || "anon"}`).toBe(expected);
        await client.query("reset role");
      }
    });
  });

  it("NEGATIV: ingen kan skrive via RLS — heller ikke admin (writes kun via service-role)", async () => {
    for (const sub of [USER.adminD, USER.ejerA, USER.partnerB]) {
      await expect(
        asUser(sub, (client) =>
          client.query(
            `insert into board_change (board_id, actor_role, action, calcom_sync)
             values ('${BOARD}', 'admin', 'tilfoej', 'opdateret')`,
          ),
        ),
        `sub=${sub}`,
      ).rejects.toThrow();
    }
  });

  it("NEGATIV: ingen kan ændre eller slette en række via RLS", async () => {
    await asPostgres(async (client) => {
      await insertChange(client);
      for (const sub of [USER.adminD, USER.ejerA]) {
        await client.query(`select set_config('request.jwt.claim.sub', '${sub}', true)`);
        await client.query("set local role app_authenticated");
        const updated = await client.query("update board_change set calcom_sync = 'fejlet'").catch(() => null);
        const deleted = await client.query("delete from board_change").catch(() => null);
        expect(updated?.rowCount ?? 0, `update som ${sub}`).toBe(0);
        expect(deleted?.rowCount ?? 0, `delete som ${sub}`).toBe(0);
        await client.query("reset role");
      }
      expect((await client.query("select calcom_sync from board_change")).rows).toEqual([{ calcom_sync: "opdateret" }]);
    });
  });
});

describe("board_change — constraints og historik", () => {
  it("INVARIANT: kun kendte handlinger, aktørroller og synkroniseringsresultater", async () => {
    for (const bad of [{ action: "slet-alt" }, { sync: "ukendt" }, { actorRole: "partner" }]) {
      await expect(asPostgres((client) => insertChange(client, bad)), JSON.stringify(bad)).rejects.toThrow(
        /violates check constraint/,
      );
    }
    for (const action of ["tilfoej", "fjern", "udskift", "saet_lead", "opdater_hosts"]) {
      await asPostgres((client) => insertChange(client, { action }));
    }
  });

  it("sletter admin-kontoen sig, nulstilles aktøren, og rækken består som anonym historik", async () => {
    await asPostgres(async (client) => {
      await insertChange(client);
      await client.query("delete from app_user where id = $1", [USER.adminD]);
      const { rows } = await client.query("select actor_id, actor_role, action from board_change");
      expect(rows).toEqual([{ actor_id: null, actor_role: "admin", action: "tilfoej" }]);
    });
  });

  it("slettes en katalogpost, nulstilles partner-referencen; slettes boardet, følger rækkerne med", async () => {
    await asPostgres(async (client) => {
      await insertChange(client);
      await client.query("delete from partner_profile where id = $1", [PROFILE_2]);
      expect((await client.query("select partner_id from board_change")).rows).toEqual([{ partner_id: null }]);

      await client.query("delete from board where id = $1", [BOARD]);
      expect((await client.query("select 1 from board_change")).rowCount).toBe(0);
    });
  });

  it("rækken bærer kun pseudonyme id'er: ingen navne- eller e-mailkolonner", async () => {
    await asPostgres(async (client) => {
      const { rows } = await client.query(
        "select column_name from information_schema.columns where table_name = 'board_change' order by column_name",
      );
      expect(rows.map((r: { column_name: string }) => r.column_name)).toEqual([
        "action",
        "actor_id",
        "actor_role",
        "board_id",
        "calcom_sync",
        "created_at",
        "id",
        "partner_id",
        "replaced_partner_id",
      ]);
    });
  });
});
