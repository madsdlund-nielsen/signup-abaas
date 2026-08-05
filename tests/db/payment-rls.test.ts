import { describe, expect, it } from "vitest";
import { asPostgres, asUser } from "./helpers";

/**
 * RLS for betalings-datamodellen (0013, ADR 0028).
 *
 * Seed: membership ba001 på A's board (frekvens 4). INGEN pricing_rule/payment_charge i seed —
 * tal er ejer-uafklarede, så testene indsætter egne rækker med ÅBENLYST syntetISKE værdier i
 * transaktioner der rulles tilbage (asPostgres; stub-politik).
 *
 * Kernekravet fra fase-3-DoD: en ejer må ALDRIG se en andens betalingsdata — og partnere må
 * ALDRIG se betalingsdata overhovedet.
 */
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b",
  adminD: "00000000-0000-0000-0000-00000000000d",
  ejerE: "00000000-0000-0000-0000-00000000000e",
};
const MEMBERSHIP = "00000000-0000-0000-0000-0000000ba001";
const MEETING_AFHOLDT = "00000000-0000-0000-0000-0000000f0002";

function countAs(sub: string | null, sql: string): Promise<number> {
  return asUser(sub, async (client) => (await client.query(sql)).rowCount ?? 0);
}

describe("membership RLS (0013) — ejer + admin, aldrig partner", () => {
  it("ejer ser sit eget membership; admin ser alt", async () => {
    expect(await countAs(USER.ejerA, "select id from membership")).toBe(1);
    expect(await countAs(USER.adminD, "select id from membership")).toBe(1);
  });

  it("NEGATIV: fremmed ejer, partner og null-session ser intet", async () => {
    expect(await countAs(USER.ejerE, "select id from membership")).toBe(0);
    expect(await countAs(USER.partnerB, "select id from membership")).toBe(0);
    expect(await countAs(null, "select id from membership")).toBe(0);
  });

  it("NEGATIV: ingen kan skrive membership via RLS (writes kun via service-role)", async () => {
    await expect(
      asUser(USER.ejerA, (client) =>
        client.query(
          `insert into membership (board_id, frequency_weeks)
           values ('00000000-0000-0000-0000-0000000b0a4d', 8)`,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("pricing_rule RLS (0013) — aktiv version er authed-læsbar, resten admin-only", () => {
  it("authed ser KUN den aktive version; admin ser alle", async () => {
    await asPostgres(async (client) => {
      await client.query(
        `insert into pricing_rule (version, base_amount_minor, per_partner_amount_minor,
           factor_4_weeks, factor_8_weeks, factor_12_weeks, is_active)
         values (1, 100, 10, 1, 1, 1, false), (2, 200, 20, 1, 1, 1, true)`,
      );
      const asEjer = await client.query(
        `select set_config('request.jwt.claim.sub', '${USER.ejerA}', true)`,
      );
      void asEjer;
      // Skift til app-rollen inde i samme transaktion for at læse med RLS.
      await client.query("set local role app_authenticated");
      const visible = await client.query("select version from pricing_rule");
      expect(visible.rowCount).toBe(1);
      expect((visible.rows[0] as { version: number }).version).toBe(2);
      await client.query("reset role");
      // Admin ser begge versioner.
      await client.query(
        `select set_config('request.jwt.claim.sub', '${USER.adminD}', true)`,
      );
      await client.query("set local role app_authenticated");
      const adminVisible = await client.query("select version from pricing_rule");
      expect(adminVisible.rowCount).toBe(2);
      await client.query("reset role");
    });
  });

  it("IDEMPOTENS/INVARIANT: højst én aktiv version (partial unique index)", async () => {
    await asPostgres(async (client) => {
      await client.query(
        `insert into pricing_rule (version, base_amount_minor, per_partner_amount_minor,
           factor_4_weeks, factor_8_weeks, factor_12_weeks, is_active)
         values (1, 100, 10, 1, 1, 1, true)`,
      );
      await expect(
        client.query(
          `insert into pricing_rule (version, base_amount_minor, per_partner_amount_minor,
             factor_4_weeks, factor_8_weeks, factor_12_weeks, is_active)
           values (2, 200, 20, 1, 1, 1, true)`,
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });
});

describe("payment_charge RLS (0013) — ejer ser egne opkrævninger, aldrig andres", () => {
  async function withCharge<T>(fn: (client: import("pg").Client) => Promise<T>): Promise<T> {
    return asPostgres(async (client) => {
      await client.query(
        `insert into pricing_rule (id, version, base_amount_minor, per_partner_amount_minor,
           factor_4_weeks, factor_8_weeks, factor_12_weeks, is_active)
         values ('00000000-0000-0000-0000-0000000ce001', 1, 100, 10, 1, 1, 1, true)`,
      );
      await client.query(
        `insert into payment_charge (meeting_id, membership_id, pricing_rule_id, amount_minor, currency)
         values ('${MEETING_AFHOLDT}', '${MEMBERSHIP}', '00000000-0000-0000-0000-0000000ce001', 120, 'DKK')`,
      );
      return fn(client);
    });
  }

  it("ejer ser sin opkrævning; fremmed ejer, partner og null-session ser intet", async () => {
    await withCharge(async (client) => {
      for (const [sub, expected] of [
        [USER.ejerA, 1],
        [USER.ejerE, 0],
        [USER.partnerB, 0],
        ["", 0],
      ] as const) {
        await client.query(`select set_config('request.jwt.claim.sub', '${sub}', true)`);
        await client.query("set local role app_authenticated");
        const result = await client.query("select id from payment_charge");
        expect(result.rowCount).toBe(expected);
        await client.query("reset role");
      }
    });
  });

  it("IDEMPOTENS: samme møde kan ikke få to opkrævninger (meeting_id unique)", async () => {
    await withCharge(async (client) => {
      await expect(
        client.query(
          `insert into payment_charge (meeting_id, membership_id, pricing_rule_id, amount_minor, currency)
           values ('${MEETING_AFHOLDT}', '${MEMBERSHIP}', '00000000-0000-0000-0000-0000000ce001', 120, 'DKK')`,
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });
});

describe("payment_webhook_event (0013) — idempotens + admin-only", () => {
  it("IDEMPOTENS: samme provider-event kan ikke registreres to gange", async () => {
    await asPostgres(async (client) => {
      const insert = `insert into payment_webhook_event (provider_event_id, event_type)
                      values ('evt-1', 'charge.gennemfoert')`;
      await client.query(insert);
      await expect(client.query(insert)).rejects.toThrow(/duplicate key|unique/i);
    });
  });

  it("NEGATIV: ejer og partner ser ingen webhook-events", async () => {
    expect(await countAs(USER.ejerA, "select id from payment_webhook_event")).toBe(0);
    expect(await countAs(USER.partnerB, "select id from payment_webhook_event")).toBe(0);
  });
});

describe("Alunta-integration (0014, ADR 0030)", () => {
  it("enum-værdien 'rapporteret' accepteres og provider_invoice_ref findes", async () => {
    await asPostgres(async (client) => {
      await client.query(
        `insert into pricing_rule (id, version, base_amount_minor, per_partner_amount_minor,
           factor_4_weeks, factor_8_weeks, factor_12_weeks, is_active)
         values ('00000000-0000-0000-0000-0000000ce002', 1, 100, 10, 1, 1, 1, true)`,
      );
      const inserted = await client.query(
        `insert into payment_charge (meeting_id, membership_id, pricing_rule_id, amount_minor,
           currency, status, provider_invoice_ref)
         values ('${MEETING_AFHOLDT}', '${MEMBERSHIP}', '00000000-0000-0000-0000-0000000ce002',
           120, 'DKK', 'rapporteret', 'inv-uuid-1')
         returning status, provider_invoice_ref`,
      );
      expect(inserted.rows[0]).toEqual({ status: "rapporteret", provider_invoice_ref: "inv-uuid-1" });
    });
  });
});
