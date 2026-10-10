import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { asPostgres, asUser } from "./helpers";

/**
 * Abonnementsfakturering (migration 0020, B-19, ADR 0056).
 *
 * Seed: membership ba001 på A's board (frekvens 4, kort mangler → billing_anchor = null).
 * Alle beløb er ÅBENLYST syntetiske test-tal i transaktioner der rulles tilbage — intet
 * forretningstal lever i migrationen eller seed'en (stub-politik).
 */
const USER = {
  ejerA: "00000000-0000-0000-0000-00000000000a",
  partnerB: "00000000-0000-0000-0000-00000000000b",
  adminD: "00000000-0000-0000-0000-00000000000d",
  ejerE: "00000000-0000-0000-0000-00000000000e",
};
const MEMBERSHIP = "00000000-0000-0000-0000-0000000ba001";
const MEETING_AFHOLDT = "00000000-0000-0000-0000-0000000f0002";
const MEETING_PLANLAGT = "00000000-0000-0000-0000-0000000f0001";
const RULE = "00000000-0000-0000-0000-0000000ce020";

async function withRule<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  return asPostgres(async (client) => {
    await client.query(
      `insert into pricing_rule (id, version, base_amount_minor, per_partner_amount_minor,
         factor_4_weeks, factor_8_weeks, factor_12_weeks, is_active)
       values ('${RULE}', 1, 100, 10, 1, 1, 1, true)`,
    );
    return fn(client);
  });
}

function insertPeriodCharge(periodStart: string, periodEnd: string): string {
  return `insert into payment_charge (membership_id, pricing_rule_id, amount_minor, currency,
            period_start, period_end, frequency_weeks, partner_count)
          values ('${MEMBERSHIP}', '${RULE}', 120, 'DKK', '${periodStart}', '${periodEnd}', 4, 2)`;
}

describe("membership: periodeanker, opsigelsesdato og leverandørens abonnement (0020)", () => {
  it("nye kolonner findes og er tomme på det seedede medlemskab (intet kort → intet anker)", async () => {
    await asPostgres(async (client) => {
      const { rows } = await client.query(
        `select billing_anchor, cancelled_at, provider_subscription_ref from membership where id = '${MEMBERSHIP}'`,
      );
      expect(rows[0]).toEqual({ billing_anchor: null, cancelled_at: null, provider_subscription_ref: null });
    });
  });

  it("billing_anchor og cancelled_at er rene datoer (ikke tidsstempler)", async () => {
    await asPostgres(async (client) => {
      const { rows } = await client.query(
        `select data_type from information_schema.columns
          where table_name = 'membership' and column_name in ('billing_anchor', 'cancelled_at')`,
      );
      expect(rows.map((r: { data_type: string }) => r.data_type)).toEqual(["date", "date"]);
    });
  });
});

describe("payment_charge: én række pr. medlemskab pr. periode (0020)", () => {
  it("en periode-opkrævning kan oprettes uden møde (meeting_id er nullable)", async () => {
    await withRule(async (client) => {
      const { rows } = await client.query(`${insertPeriodCharge("2026-10-01", "2026-10-29")} returning meeting_id, status`);
      expect(rows[0]).toEqual({ meeting_id: null, status: "afventer" });
    });
  });

  it("IDEMPOTENS: samme medlemskab kan ikke få to opkrævninger for samme periode", async () => {
    await withRule(async (client) => {
      await client.query(insertPeriodCharge("2026-10-01", "2026-10-29"));
      await expect(client.query(insertPeriodCharge("2026-10-01", "2026-10-29"))).rejects.toThrow(
        /payment_charge_membership_period_unique|duplicate key/i,
      );
    });
  });

  it("næste periode for samme medlemskab er tilladt", async () => {
    await withRule(async (client) => {
      await client.query(insertPeriodCharge("2026-10-01", "2026-10-29"));
      await client.query(insertPeriodCharge("2026-10-29", "2026-11-26"));
      const { rows } = await client.query("select count(*)::int as n from payment_charge");
      expect(rows[0].n).toBe(2);
    });
  });

  it("ON CONFLICT DO NOTHING gør kørslen idempotent uden fejl", async () => {
    await withRule(async (client) => {
      const sql = `${insertPeriodCharge("2026-10-01", "2026-10-29")} on conflict (membership_id, period_start) do nothing`;
      await client.query(sql);
      const second = await client.query(sql);
      expect(second.rowCount).toBe(0);
    });
  });

  it("NEGATIV: en række uden hverken møde eller periode afvises", async () => {
    await withRule(async (client) => {
      await expect(
        client.query(
          `insert into payment_charge (membership_id, pricing_rule_id, amount_minor, currency)
           values ('${MEMBERSHIP}', '${RULE}', 120, 'DKK')`,
        ),
      ).rejects.toThrow(/payment_charge_subject/);
    });
  });

  it("NEGATIV: perioden skal have både start og slut, og slut skal ligge efter start", async () => {
    await withRule(async (client) => {
      await expect(
        client.query(
          `insert into payment_charge (membership_id, pricing_rule_id, amount_minor, currency, period_start)
           values ('${MEMBERSHIP}', '${RULE}', 120, 'DKK', '2026-10-01')`,
        ),
      ).rejects.toThrow(/payment_charge_period_pair/);
    });
    await withRule(async (client) => {
      await expect(client.query(insertPeriodCharge("2026-10-29", "2026-10-29"))).rejects.toThrow(
        /payment_charge_period_order/,
      );
    });
  });

  it("NEGATIV: audit-felterne afviser ugyldig frekvens og et board uden rådgivere", async () => {
    await withRule(async (client) => {
      await expect(
        client.query(
          `insert into payment_charge (membership_id, pricing_rule_id, amount_minor, currency,
             period_start, period_end, frequency_weeks)
           values ('${MEMBERSHIP}', '${RULE}', 120, 'DKK', '2026-10-01', '2026-10-29', 6)`,
        ),
      ).rejects.toThrow(/payment_charge_frequency_check/);
    });
    await withRule(async (client) => {
      await expect(
        client.query(
          `insert into payment_charge (membership_id, pricing_rule_id, amount_minor, currency,
             period_start, period_end, partner_count)
           values ('${MEMBERSHIP}', '${RULE}', 120, 'DKK', '2026-10-01', '2026-10-29', 0)`,
        ),
      ).rejects.toThrow(/payment_charge_partner_count_check/);
    });
  });

  it("IKKE-DESTRUKTIVT: gamle pr.-møde-rækker virker stadig — og kolliderer ikke med periodekæden", async () => {
    await withRule(async (client) => {
      const legacy = (meeting: string) =>
        `insert into payment_charge (meeting_id, membership_id, pricing_rule_id, amount_minor, currency)
         values ('${meeting}', '${MEMBERSHIP}', '${RULE}', 120, 'DKK')`;
      // To gamle rækker (period_start = null) for forskellige møder: null er forskellig fra null i unique.
      await client.query(legacy(MEETING_AFHOLDT));
      await client.query(legacy(MEETING_PLANLAGT));
      await client.query(insertPeriodCharge("2026-10-01", "2026-10-29"));
      const { rows } = await client.query("select count(*)::int as n from payment_charge");
      expect(rows[0].n).toBe(3);
      // meeting_id er stadig unique for de gamle rækker (sidst: en fejl afbryder transaktionen).
      await expect(client.query(legacy(MEETING_AFHOLDT))).rejects.toThrow(/duplicate key|unique/i);
    });
  });
});

describe("payment_charge RLS uændret for periode-rækker (0020)", () => {
  async function visibleTo(sub: string): Promise<number> {
    return withRule(async (client) => {
      await client.query(insertPeriodCharge("2026-10-01", "2026-10-29"));
      await client.query(`select set_config('request.jwt.claim.sub', '${sub}', true)`);
      await client.query("set local role app_authenticated");
      const result = await client.query("select id from payment_charge");
      await client.query("reset role");
      return result.rowCount ?? 0;
    });
  }

  it("ejeren ser sin egen periode-opkrævning; admin ser alle", async () => {
    expect(await visibleTo(USER.ejerA)).toBe(1);
    expect(await visibleTo(USER.adminD)).toBe(1);
  });

  it("NEGATIV: fremmed ejer og partner ser ingen periode-opkrævninger", async () => {
    expect(await visibleTo(USER.ejerE)).toBe(0);
    expect(await visibleTo(USER.partnerB)).toBe(0);
  });

  it("NEGATIV: anonym session ser intet", async () => {
    expect(await visibleTo("")).toBe(0);
  });

  it("NEGATIV: ejeren kan ikke selv skrive en opkrævning, flytte sit periodeanker eller opsige via RLS", async () => {
    await expect(
      withRule(async (client) => {
        await client.query(`select set_config('request.jwt.claim.sub', '${USER.ejerA}', true)`);
        await client.query("set local role app_authenticated");
        await client.query(insertPeriodCharge("2026-10-01", "2026-10-29"));
      }),
    ).rejects.toThrow(/row-level security/i);

    // Ingen write-policy på membership: update rammer 0 rækker (RLS filtrerer dem væk), anker uændret.
    await asUser(USER.ejerA, async (client) => {
      const updated = await client.query(
        `update membership set billing_anchor = '2020-01-01', cancelled_at = '2020-01-01' where id = '${MEMBERSHIP}'`,
      );
      expect(updated.rowCount).toBe(0);
    });
    await asPostgres(async (client) => {
      const { rows } = await client.query(`select billing_anchor, cancelled_at from membership where id = '${MEMBERSHIP}'`);
      expect(rows[0]).toEqual({ billing_anchor: null, cancelled_at: null });
    });
  });
});
