import { describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asPostgres, asUser } from "./helpers";

/**
 * Cal.com-id'erne (0019, ADR 0046): board.calcom_event_type_id + partner_profile.calcom_user_id.
 * Kolonnerne må ikke åbne nye læse- eller skrivestier — de arver de eksisterende policies og
 * skrives kun via service-role bag admin. Seed: board b0a4d ejes af ejer-A; partner-B er koblet
 * til katalogpost e0001 (på boardet); ejer-E har intet board; partner-C er ukoblet.
 */
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b",
  partnerC: "00000000-0000-0000-0000-00000000000c",
  adminD: "00000000-0000-0000-0000-00000000000d",
  ejerE: "00000000-0000-0000-0000-00000000000e",
};
const BOARD = "00000000-0000-0000-0000-0000000b0a4d";
const PROFILE_1 = "00000000-0000-0000-0000-0000000e0001";
const PROFILE_2 = "00000000-0000-0000-0000-0000000e0002";

/** Kør sql som DB-ejer (≈ service-role, bypasser RLS) midt i en authed transaktion. */
async function asServiceRole(client: Client, sql: string): Promise<void> {
  await client.query("reset role");
  await client.query(sql);
  await client.query("set local role app_authenticated");
}

/** Sæt id'erne som service-role og kør derefter fn som den givne bruger. */
function withIdsAs<T>(sub: string | null, fn: (client: Client) => Promise<T>): Promise<T> {
  return asUser(sub, async (client) => {
    await asServiceRole(
      client,
      `update board set calcom_event_type_id = 4242 where id = '${BOARD}';
       update partner_profile set calcom_user_id = 77 where id = '${PROFILE_1}';
       update partner_profile set calcom_user_id = 78 where id = '${PROFILE_2}'`,
    );
    return fn(client);
  });
}

describe("calcom-kolonner (0019) — læsning følger eksisterende policies", () => {
  it("ejer læser event type-id på sit eget board", async () => {
    await withIdsAs(USER.ejerA, async (client) => {
      const { rows } = await client.query("select calcom_event_type_id from board");
      expect(rows).toEqual([{ calcom_event_type_id: 4242 }]);
    });
  });

  it("koblet partner læser board-id og egen Cal.com-bruger", async () => {
    await withIdsAs(USER.partnerB, async (client) => {
      const board = await client.query("select calcom_event_type_id from board");
      expect(board.rows).toEqual([{ calcom_event_type_id: 4242 }]);
      const own = await client.query(`select calcom_user_id from partner_profile where id = '${PROFILE_1}'`);
      expect(own.rows).toEqual([{ calcom_user_id: 77 }]);
    });
  });

  it("admin læser begge", async () => {
    await withIdsAs(USER.adminD, async (client) => {
      const boards = await client.query("select 1 from board where calcom_event_type_id is not null");
      expect(boards.rowCount).toBe(1);
      const partners = await client.query("select 1 from partner_profile where calcom_user_id is not null");
      expect(partners.rowCount).toBe(2);
    });
  });

  it("NEGATIV: fremmed ejer, ukoblet partner og anonym læser intet", async () => {
    for (const sub of [USER.ejerE, USER.partnerC, null]) {
      await withIdsAs(sub, async (client) => {
        expect((await client.query("select 1 from board")).rowCount, `board som ${sub}`).toBe(0);
        expect((await client.query("select 1 from partner_profile")).rowCount, `profil som ${sub}`).toBe(0);
      });
    }
  });

  it("NEGATIV: partner ser ikke Cal.com-bruger på en katalogpost uden for sit board", async () => {
    await withIdsAs(USER.partnerB, async (client) => {
      const outside = await client.query(`select calcom_user_id from partner_profile where id = '${PROFILE_2}'`);
      expect(outside.rowCount).toBe(0);
    });
  });
});

describe("calcom-kolonner (0019) — ingen skrivestier via RLS", () => {
  it("NEGATIV: ejer, partner og admin kan ikke opdatere event type-id (0 rækker, uændret)", async () => {
    for (const sub of [USER.ejerA, USER.partnerB, USER.adminD]) {
      await asUser(sub, async (client) => {
        const update = await client.query(`update board set calcom_event_type_id = 9 where id = '${BOARD}'`);
        expect(update.rowCount, `board-update som ${sub}`).toBe(0);
        await client.query("reset role");
        const { rows } = await client.query(`select calcom_event_type_id from board where id = '${BOARD}'`);
        expect(rows[0].calcom_event_type_id).toBeNull();
      });
    }
  });

  it("NEGATIV: ejer, partner og admin kan ikke opdatere calcom_user_id (0 rækker, uændret)", async () => {
    for (const sub of [USER.ejerA, USER.partnerB, USER.adminD]) {
      await asUser(sub, async (client) => {
        const update = await client.query(`update partner_profile set calcom_user_id = 9 where id = '${PROFILE_1}'`);
        expect(update.rowCount, `partner-update som ${sub}`).toBe(0);
        await client.query("reset role");
        const { rows } = await client.query(`select calcom_user_id from partner_profile where id = '${PROFILE_1}'`);
        expect(rows[0].calcom_user_id).toBeNull();
      });
    }
  });
});

describe("calcom-kolonner (0019) — integritet", () => {
  it("to boards kan ikke dele et event type", async () => {
    await asPostgres(async (client) => {
      await client.query(`update board set calcom_event_type_id = 5 where id = '${BOARD}'`);
      await client.query(
        `insert into board (id, owner_id, name) values ('00000000-0000-0000-0000-0000000b0a4e', '${USER.ejerE}', 'E')`,
      );
      await expect(
        client.query("update board set calcom_event_type_id = 5 where id = '00000000-0000-0000-0000-0000000b0a4e'"),
      ).rejects.toThrow(/board_calcom_event_type_id_key/);
    });
  });

  it("to katalogposter kan ikke dele et Cal.com-sæde", async () => {
    await asPostgres(async (client) => {
      await client.query(`update partner_profile set calcom_user_id = 5 where id = '${PROFILE_1}'`);
      await expect(
        client.query(`update partner_profile set calcom_user_id = 5 where id = '${PROFILE_2}'`),
      ).rejects.toThrow(/partner_profile_calcom_user_id_key/);
    });
  });

  it("id'er skal være positive heltal", async () => {
    await asPostgres(async (client) => {
      await expect(client.query(`update board set calcom_event_type_id = 0 where id = '${BOARD}'`)).rejects.toThrow();
    });
    await asPostgres(async (client) => {
      await expect(
        client.query(`update partner_profile set calcom_user_id = -1 where id = '${PROFILE_1}'`),
      ).rejects.toThrow();
    });
  });
});
