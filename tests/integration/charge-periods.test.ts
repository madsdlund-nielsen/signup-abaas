import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotConfiguredError } from "@/lib/errors";
import type { PaymentProvider, SubscriptionRequest } from "@/lib/payments";
import { POST } from "@/app/api/cron/charge-periods/route";
import { createChargesForDuePeriods } from "@/server/charges/create";
import { addDays, copenhagenDate } from "@/server/charges/periods";
import { syncPendingSubscriptions } from "@/server/charges/sync";

/**
 * Den planlagte kørsel (B-19, ADR 0056) mod en in-memory Supabase-dobbelt. Alle tal er
 * ÅBENLYST syntetiske test-tal (base 100, 10 pr. partner, faktorer 1 / 0,5 / 0,25) — de
 * står ingen steder i kode eller seed.
 */
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

// Kun routen bruger createServiceSupabase; resten får dobbelten injiceret direkte.
const mocked = vi.hoisted(() => ({ service: null as unknown }));
vi.mock("@/server/auth/supabase-server", () => ({
  createServiceSupabase: () => mocked.service,
  createServerSupabase: async () => mocked.service,
}));

/** Minimal PostgREST-lignende dobbelt: select/eq/in/is/not/order/maybeSingle/insert/update. */
function fakeDb(tables: Tables) {
  const uniqueViolations: string[] = [];
  const client = {
    tables,
    uniqueViolations,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let mode: "select" | "update" = "select";
      let patch: Row = {};
      let orderBy: { column: string; ascending: boolean } | null = null;
      let embed: string | null = null;

      const rows = () => {
        let result = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
        if (orderBy) {
          const { column, ascending } = orderBy;
          result = [...result].sort((a, b) => {
            const left = String(a[column] ?? "");
            const right = String(b[column] ?? "");
            return ascending ? left.localeCompare(right) : right.localeCompare(left);
          });
        }
        return result.map((row) =>
          embed ? { ...row, [embed]: (tables[embed] ?? []).find((r) => r.id === row[`${embed}_id`]) ?? null } : row,
        );
      };

      const query = {
        select(columns?: string) {
          const match = columns?.match(/(\w+)\(/);
          embed = match?.[1] ?? null;
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return query;
        },
        in(column: string, values: unknown[]) {
          filters.push((row) => values.includes(row[column]));
          return query;
        },
        is(column: string, value: unknown) {
          filters.push((row) => (row[column] ?? null) === value);
          return query;
        },
        not(column: string, _operator: string, value: unknown) {
          filters.push((row) => (row[column] ?? null) !== value);
          return query;
        },
        order(column: string, options?: { ascending?: boolean }) {
          orderBy = { column, ascending: options?.ascending ?? true };
          return query;
        },
        async maybeSingle() {
          return { data: rows()[0] ?? null, error: null };
        },
        update(values: Row) {
          mode = "update";
          patch = values;
          return query;
        },
        async insert(row: Row) {
          const existing = tables[table] ?? [];
          if (
            table === "payment_charge" &&
            existing.some((r) => r.membership_id === row.membership_id && r.period_start === row.period_start)
          ) {
            uniqueViolations.push(`${row.membership_id}:${row.period_start}`);
            return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          tables[table] = [...existing, { id: `${table}-${existing.length + 1}`, status: "afventer", ...row }];
          return { error: null };
        },
        then(resolve: (r: { data: Row[] | null; error: null }) => unknown, reject?: (e: unknown) => unknown) {
          if (mode === "update") {
            for (const row of rows()) Object.assign(row, patch);
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return client as unknown as SupabaseClient & { tables: Tables; uniqueViolations: string[] };
}

const RULE_ID = "rule-1";
const BOARD = "board-1";
const MEMBERSHIP = "membership-1";

function baseTables(overrides: Partial<Tables> = {}): Tables {
  return {
    pricing_rule: [
      {
        id: RULE_ID,
        version: 1,
        base_amount_minor: 100,
        per_partner_amount_minor: 10,
        factor_4_weeks: "1",
        factor_8_weeks: "0.5",
        factor_12_weeks: "0.25",
        currency: "DKK",
        is_active: true,
      },
    ],
    membership: [
      {
        id: MEMBERSHIP,
        board_id: BOARD,
        frequency_weeks: 4,
        status: "aktiv",
        card_status: "registreret",
        billing_anchor: "2026-10-01",
        cancelled_at: null,
        provider_customer_ref: "cus-1",
        provider_subscription_ref: "sub-1",
      },
    ],
    board_partner: [
      { board_id: BOARD, partner_id: "p1" },
      { board_id: BOARD, partner_id: "p2" },
    ],
    payment_charge: [],
    ...overrides,
  };
}

const DAY_ONE = new Date("2026-10-10T08:00:00Z"); // indeværende periode: [2026-10-01, 2026-10-29)

describe("createChargesForDuePeriods — opkrævning pr. 4-ugers periode, ikke pr. møde", () => {
  it("opretter indeværende periodes opkrævning med regelens formel og audit-felter", async () => {
    const db = fakeDb(baseTables());
    const result = await createChargesForDuePeriods(db, DAY_ONE);

    expect(result).toMatchObject({ created: 1, alreadyExisted: 0, skipped: [], noActiveRule: false });
    expect(db.tables.payment_charge).toHaveLength(1);
    // (100 + 2 × 10) × 1 = 120 øre (syntetisk).
    expect(db.tables.payment_charge?.[0]).toMatchObject({
      membership_id: MEMBERSHIP,
      pricing_rule_id: RULE_ID,
      amount_minor: 120,
      currency: "DKK",
      period_start: "2026-10-01",
      period_end: "2026-10-29",
      frequency_weeks: 4,
      partner_count: 2,
    });
    // Ingen kobling til møder.
    expect(db.tables.payment_charge?.[0]).not.toHaveProperty("meeting_id");
  });

  it("IDEMPOTENT: en gentagen kørsel i samme periode opretter ingen dublet", async () => {
    const db = fakeDb(baseTables());
    await createChargesForDuePeriods(db, DAY_ONE);
    const again = await createChargesForDuePeriods(db, new Date("2026-10-11T08:00:00Z"));

    expect(again).toMatchObject({ created: 0, alreadyExisted: 1 });
    expect(db.tables.payment_charge).toHaveLength(1);
    expect(db.uniqueViolations).toEqual([`${MEMBERSHIP}:2026-10-01`]);
  });

  it("næste periode (28 dage senere) får sin egen række", async () => {
    const db = fakeDb(baseTables());
    await createChargesForDuePeriods(db, DAY_ONE);
    const next = await createChargesForDuePeriods(db, new Date("2026-10-29T08:00:00Z"));

    expect(next.created).toBe(1);
    expect(db.tables.payment_charge?.map((c) => c.period_start)).toEqual(["2026-10-01", "2026-10-29"]);
  });

  it("frekvens og boardstørrelse regnes PÅ PERIODENS START — en gammel periode røres aldrig (ingen proratering)", async () => {
    const db = fakeDb(baseTables());
    await createChargesForDuePeriods(db, DAY_ONE);

    // Midt i perioden: nedgradering til hver 8. uge og en tredje rådgiver.
    const membership = db.tables.membership?.[0] as Row;
    membership.frequency_weeks = 8;
    db.tables.board_partner?.push({ board_id: BOARD, partner_id: "p3" });
    await createChargesForDuePeriods(db, new Date("2026-10-15T08:00:00Z"));
    expect(db.tables.payment_charge).toHaveLength(1);
    expect(db.tables.payment_charge?.[0]).toMatchObject({ amount_minor: 120, frequency_weeks: 4, partner_count: 2 });

    // Næste periode: den nye pris — (100 + 3 × 10) × 0,5 = 65.
    await createChargesForDuePeriods(db, new Date("2026-10-29T08:00:00Z"));
    expect(db.tables.payment_charge?.[1]).toMatchObject({
      amount_minor: 65,
      frequency_weeks: 8,
      partner_count: 3,
      period_start: "2026-10-29",
    });
  });

  it("NEGATIV: uden aktiv prisregel oprettes intet og hullet meldes", async () => {
    const db = fakeDb(baseTables({ pricing_rule: [] }));
    const result = await createChargesForDuePeriods(db, DAY_ONE);
    expect(result.noActiveRule).toBe(true);
    expect(db.tables.payment_charge).toHaveLength(0);
  });

  it("NEGATIV: kort ikke registreret eller intet periodeanker → ingen opkrævning", async () => {
    const noCard = baseTables();
    (noCard.membership?.[0] as Row).card_status = "mangler";
    const noAnchor = baseTables();
    (noAnchor.membership?.[0] as Row).billing_anchor = null;
    for (const tables of [noCard, noAnchor]) {
      const db = fakeDb(tables);
      await expect(createChargesForDuePeriods(db, DAY_ONE)).resolves.toMatchObject({ created: 0 });
      expect(db.tables.payment_charge).toHaveLength(0);
    }
  });

  it("NEGATIV: før ankeret er abonnementet ikke begyndt", async () => {
    const db = fakeDb(baseTables());
    const result = await createChargesForDuePeriods(db, new Date("2026-09-20T08:00:00Z"));
    expect(result.created).toBe(0);
  });

  it("opsagt: perioden der allerede er startet hentes ind, men ingen ny efter opsigelsesdatoen", async () => {
    const tables = baseTables();
    Object.assign(tables.membership?.[0] as Row, { status: "opsagt", cancelled_at: "2026-10-15" });
    const db = fakeDb(tables);

    expect((await createChargesForDuePeriods(db, DAY_ONE)).created).toBe(1);
    // Næste periode starter 2026-10-29, efter opsigelsen 2026-10-15 → ingen ny række.
    expect((await createChargesForDuePeriods(db, new Date("2026-10-29T08:00:00Z"))).created).toBe(0);
    expect(db.tables.payment_charge).toHaveLength(1);
  });

  it("NEGATIV: opsagt uden opsigelsesdato afskærer alt (vi ved ikke fra hvornår)", async () => {
    const tables = baseTables();
    Object.assign(tables.membership?.[0] as Row, { status: "opsagt", cancelled_at: null });
    const db = fakeDb(tables);
    expect((await createChargesForDuePeriods(db, DAY_ONE)).created).toBe(0);
  });

  it("NEGATIV: et board uden partnere springes over og meldes — intet beløb gættes", async () => {
    const db = fakeDb(baseTables({ board_partner: [] }));
    const result = await createChargesForDuePeriods(db, DAY_ONE);
    expect(result.created).toBe(0);
    expect(result.skipped).toEqual([{ membershipId: MEMBERSHIP, reason: "boardet har ingen partnere" }]);
  });

  it("oversprungne perioder efterfaktureres IKKE: kun indeværende periode oprettes", async () => {
    const db = fakeDb(baseTables());
    // Kørslen lå stille i 100 dage: periodeindeks 3 (2026-12-24) er den eneste der oprettes.
    const result = await createChargesForDuePeriods(db, new Date("2027-01-09T08:00:00Z"));
    expect(result.created).toBe(1);
    expect(db.tables.payment_charge?.[0]?.period_start).toBe("2026-12-24");
  });
});

function fakeProvider(behaviour: "ok" | "stub" | "fail"): PaymentProvider & { calls: SubscriptionRequest[] } {
  const calls: SubscriptionRequest[] = [];
  return {
    name: "fake",
    calls,
    async registerCard() {
      throw new Error("ikke brugt");
    },
    async upsertSubscription(req) {
      calls.push(req);
      if (behaviour === "stub") throw new NotConfiguredError("alunta", "upsertSubscription");
      if (behaviour === "fail") throw new Error("Alunta nede");
      return { id: req.subscriptionRef ?? "sub-ny" };
    },
  };
}

describe("syncPendingSubscriptions — abonnementets pris meldes til leverandøren", () => {
  async function seeded() {
    const db = fakeDb(baseTables());
    await createChargesForDuePeriods(db, DAY_ONE);
    await createChargesForDuePeriods(db, new Date("2026-10-29T08:00:00Z"));
    return db;
  }

  it("sender den NYESTE periodes beløb, kadencen 28 dage og ankeret; rækkerne bliver 'rapporteret'", async () => {
    const db = await seeded();
    const provider = fakeProvider("ok");
    const result = await syncPendingSubscriptions(db, provider);

    expect(result).toEqual({ reported: 1, failed: 0, notConfigured: null });
    expect(provider.calls).toEqual([
      {
        membershipId: MEMBERSHIP,
        customerRef: "cus-1",
        subscriptionRef: "sub-1",
        amountMinor: 120,
        currency: "DKK",
        intervalDays: 28,
        startsOn: "2026-10-01",
      },
    ]);
    expect(db.tables.payment_charge?.map((c) => c.status)).toEqual(["rapporteret", "rapporteret"]);
  });

  it("gemmer en ny abonnementsreference på medlemskabet", async () => {
    const db = await seeded();
    (db.tables.membership?.[0] as Row).provider_subscription_ref = null;
    await syncPendingSubscriptions(db, fakeProvider("ok"));
    expect(db.tables.membership?.[0]?.provider_subscription_ref).toBe("sub-ny");
  });

  it("allerede rapporterede rækker sendes ikke igen", async () => {
    const db = await seeded();
    await syncPendingSubscriptions(db, fakeProvider("ok"));
    const again = fakeProvider("ok");
    expect(await syncPendingSubscriptions(db, again)).toMatchObject({ reported: 0 });
    expect(again.calls).toHaveLength(0);
  });

  it("STUB aktiv: stopper ærligt, rækkerne står som 'afventer'", async () => {
    const db = await seeded();
    const result = await syncPendingSubscriptions(db, fakeProvider("stub"));
    expect(result.notConfigured).toMatch(/ikke konfigureret/);
    expect(result.reported).toBe(0);
    expect(db.tables.payment_charge?.every((c) => c.status === "afventer")).toBe(true);
  });

  it("forbigående API-fejl gør IKKE rækken endeligt 'fejlet' — den afventer og prøves igen", async () => {
    const db = await seeded();
    const result = await syncPendingSubscriptions(db, fakeProvider("fail"));
    expect(result).toMatchObject({ reported: 0, failed: 1 });
    expect(db.tables.payment_charge?.every((c) => c.status === "afventer")).toBe(true);
    expect(db.tables.payment_charge?.[0]?.failure_reason).toBe("Alunta nede");

    // Næste kørsel lykkes, og årsagen ryddes.
    await syncPendingSubscriptions(db, fakeProvider("ok"));
    expect(db.tables.payment_charge?.every((c) => c.status === "rapporteret")).toBe(true);
    expect(db.tables.payment_charge?.[0]?.failure_reason).toBeNull();
  });

  it("NEGATIV: uden kunde-reference kaldes leverandøren ikke", async () => {
    const db = await seeded();
    (db.tables.membership?.[0] as Row).provider_customer_ref = null;
    const provider = fakeProvider("ok");
    const result = await syncPendingSubscriptions(db, provider);
    expect(result).toMatchObject({ reported: 0, failed: 1 });
    expect(provider.calls).toHaveLength(0);
    expect(db.tables.payment_charge?.[0]?.failure_reason).toMatch(/Kortet er ikke registreret/);
  });
});

describe("/api/cron/charge-periods — aldrig åben uden hemmelighed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function call(secret?: string): Promise<Response> {
    return POST(
      new Request("http://localhost/api/cron/charge-periods", {
        method: "POST",
        headers: secret ? { "x-cron-secret": secret } : {},
      }),
    );
  }

  it("NEGATIV: uden CRON_SECRET svarer routen 503 (aldrig fail-open)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("hvad-som-helst")).status).toBe(503);
  });

  it("NEGATIV: manglende eller forkert hemmelighed → 401", async () => {
    vi.stubEnv("CRON_SECRET", "rigtig");
    expect((await call()).status).toBe(401);
    expect((await call("forkert")).status).toBe(401);
    expect((await call("rigtigX")).status).toBe(401);
  });

  it("med korrekt hemmelighed men FLAG_PAYMENTS slået fra gøres intet", async () => {
    vi.stubEnv("CRON_SECRET", "rigtig");
    vi.stubEnv("FLAG_PAYMENTS", "");
    const response = await call("rigtig");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ skipped: "FLAG_PAYMENTS er slået fra." });
  });

  it("med hemmelighed og flag opretter den perioderne og melder prisen (stub → afventer ærligt)", async () => {
    const db = fakeDb(baseTables());
    // Routen bruger det rigtige "nu" — ankeret skal derfor være relativt, ikke en fast dato.
    (db.tables.membership?.[0] as Row).billing_anchor = addDays(copenhagenDate(new Date()), -3);
    mocked.service = db;
    vi.stubEnv("CRON_SECRET", "rigtig");
    vi.stubEnv("FLAG_PAYMENTS", "true");
    vi.stubEnv("FLAG_DEMO", "");
    vi.stubEnv("ALUNTA_API_KEY", "");
    vi.stubEnv("ALUNTA_PLAN_ID", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");

    const response = await call("rigtig");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { periods: { created: number }; sync: { notConfigured: string | null } };
    expect(body.periods.created).toBe(1);
    expect(body.sync.notConfigured).toMatch(/ikke konfigureret/);
    expect(db.tables.payment_charge?.[0]?.status).toBe("afventer");

    // Idempotent: en dobbeltaflevering fra Netlify opretter ikke en ny række.
    const again = (await (await call("rigtig")).json()) as { periods: { created: number; alreadyExisted: number } };
    expect(again.periods).toMatchObject({ created: 0, alreadyExisted: 1 });
    expect(db.tables.payment_charge).toHaveLength(1);
  });

  it("med flag, men uden Supabase-konfiguration → 503", async () => {
    vi.stubEnv("CRON_SECRET", "rigtig");
    vi.stubEnv("FLAG_PAYMENTS", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await call("rigtig")).status).toBe(503);
  });
});
