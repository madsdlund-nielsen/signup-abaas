import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthUser } from "@/server/auth";
import { getLeadBoardNeeds, getMyMonthFees } from "@/server/dashboard";
import { loadFeeTotals } from "@/server/fees";

// Auth og Supabase-klienten mockes: sessionen styrer hvem der er logget ind, og service-/db-
// klienten er en fake af PostgREST-kæden (ingen netværk). Selve RLS-grænserne dækkes i
// tests/db/dashboard-read-paths.test.ts.
const mocked = vi.hoisted(() => ({ service: null as unknown, user: null as unknown }));
vi.mock("@/server/auth/supabase-server", () => ({
  createServiceSupabase: () => mocked.service,
  createServerSupabase: async () => mocked.service,
}));
vi.mock("@/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth")>()),
  getCurrentUser: async () => mocked.user,
}));

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "a",
  SUPABASE_SERVICE_ROLE_KEY: "s",
};

type Rows = Record<string, unknown[] | { error: string }>;

/** Fake af PostgREST-kæden. `touched` husker hvilke tabeller der blev læst. */
function fakeClient(tables: Rows): { client: SupabaseClient; touched: string[] } {
  const touched: string[] = [];
  const builder = (name: string) => {
    touched.push(name);
    const source = tables[name] ?? [];
    const failure = !Array.isArray(source) ? { message: source.error } : null;
    const result = failure ? { data: null, error: failure } : { data: source, error: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      gte: () => chain,
      lt: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({
        data: Array.isArray(source) ? (source[0] ?? null) : null,
        error: failure,
      }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  };
  return { client: { from: builder } as unknown as SupabaseClient, touched };
}

function userWith(...roles: AuthUser["roles"]): AuthUser {
  return { id: "u1", email: "u1@example.com", roles };
}

const LEAD_TABLES: Rows = {
  partner_profile: [{ id: "pp1" }],
  board_partner: [{ board_id: "b1" }],
  board: [{ owner_id: "owner1" }],
  quiz_answer: [{ quiz_option_id: "o1" }, { quiz_option_id: "o2" }],
  quiz_option_competence_tag: [
    { competence_tag_id: "t1" },
    { competence_tag_id: "t2" },
    { competence_tag_id: "t1" },
  ],
};

describe("getLeadBoardNeeds — service-role bag lead-tjek (ADR 0055)", () => {
  beforeEach(() => {
    mocked.user = userWith("partner");
    mocked.service = fakeClient(LEAD_TABLES).client;
  });

  it("uden Supabase-konfiguration giver den null (kontofri CI/dev)", async () => {
    await expect(getLeadBoardNeeds("b1", {})).resolves.toBeNull();
  });

  it("lead på boardet: kun unikke tag-id'er forlader funktionen", async () => {
    await expect(getLeadBoardNeeds("b1", ENV)).resolves.toEqual({
      boardId: "b1",
      ownerTagIds: ["t1", "t2"],
    });
  });

  it("NEGATIV: ikke logget ind → null, intet læses", async () => {
    mocked.user = null;
    const fake = fakeClient(LEAD_TABLES);
    mocked.service = fake.client;
    await expect(getLeadBoardNeeds("b1", ENV)).resolves.toBeNull();
    expect(fake.touched).toEqual([]);
  });

  it("NEGATIV: ejer, admin og lead_partner-rolle uden partner-rolle → null, intet læses", async () => {
    for (const roles of [["ejer"], ["admin"], ["lead_partner"]] as const) {
      mocked.user = userWith(...roles);
      const fake = fakeClient(LEAD_TABLES);
      mocked.service = fake.client;
      await expect(getLeadBoardNeeds("b1", ENV)).resolves.toBeNull();
      expect(fake.touched).toEqual([]);
    }
  });

  it("NEGATIV: partner uden katalogprofil → null, ejerens svar røres ikke", async () => {
    const fake = fakeClient({ ...LEAD_TABLES, partner_profile: [] });
    mocked.service = fake.client;
    await expect(getLeadBoardNeeds("b1", ENV)).resolves.toBeNull();
    expect(fake.touched).not.toContain("quiz_answer");
    expect(fake.touched).not.toContain("board");
  });

  it("NEGATIV: partner der IKKE er lead på boardet → null, ejerens svar røres ikke", async () => {
    const fake = fakeClient({ ...LEAD_TABLES, board_partner: [] });
    mocked.service = fake.client;
    await expect(getLeadBoardNeeds("b1", ENV)).resolves.toBeNull();
    expect(fake.touched).toEqual(["partner_profile", "board_partner"]);
  });

  it("fejl i lead-tjekket → null (aldrig adgang ved tvivl)", async () => {
    const fake = fakeClient({ ...LEAD_TABLES, board_partner: { error: "boom" } });
    mocked.service = fake.client;
    await expect(getLeadBoardNeeds("b1", ENV)).resolves.toBeNull();
    expect(fake.touched).not.toContain("quiz_answer");
  });

  it("ejeren har ikke svaret: tom liste (ikke null) — 'ingen behov' er noget andet end 'kunne ikke læses'", async () => {
    mocked.service = fakeClient({ ...LEAD_TABLES, quiz_answer: [] }).client;
    await expect(getLeadBoardNeeds("b1", ENV)).resolves.toEqual({ boardId: "b1", ownerTagIds: [] });
  });

  it("fejl i behovslæsningen → null, ikke en tom liste der ligner 'ingen behov'", async () => {
    mocked.service = fakeClient({ ...LEAD_TABLES, quiz_answer: { error: "boom" } }).client;
    await expect(getLeadBoardNeeds("b1", ENV)).resolves.toBeNull();
    mocked.service = fakeClient({ ...LEAD_TABLES, quiz_option_competence_tag: { error: "boom" } }).client;
    await expect(getLeadBoardNeeds("b1", ENV)).resolves.toBeNull();
  });
});

describe("getMyMonthFees uden Supabase-konfiguration", () => {
  it("giver tomme tal og 'ingen regler' frem for at gætte", async () => {
    const result = await getMyMonthFees(new Date("2026-10-10T12:00:00Z"), {});
    expect(result.month).toBe("2026-10");
    expect(result.hasRules).toBe(false);
    expect(result.totals.calculatedCount).toBe(0);
    expect(result.totals.totalsByCurrency).toEqual([]);
  });
});

describe("loadFeeTotals — driftsoverblikkets honorartal", () => {
  const period = { from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z" };
  const line = (overrides: Record<string, unknown> = {}) => ({
    meeting_id: "m1",
    partner_profile_id: "p1",
    app_user_id: null,
    partner_name: "Partner Én",
    starts_at: "2026-10-05T10:00:00Z",
    meeting_status: "afholdt",
    duration_minutes: 60,
    prep_minutes: 15,
    registered_status: "afholdt",
    ...overrides,
  });
  const rule = {
    id: "r1",
    version: 1,
    hourly_rate_minor: 6000, // åbenlyst syntetisk testværdi, ikke en sats
    currency: "DKK",
    vat_mode: "ikke_fastlagt",
    absence_rule: "ikke_fastlagt",
    effective_from: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
  };

  it("uden regler: ingen sats — ingen beløb, og ruleCount er 0", async () => {
    const { client } = fakeClient({ partner_fee_line: [line()], fee_rule: [] });
    const result = await loadFeeTotals(client, period, 1000);
    expect(result.ruleCount).toBe(0);
    expect(result.lineCount).toBe(1);
    expect(result.totals.noRateCount).toBe(1);
    expect(result.totals.totalsByCurrency).toEqual([]);
  });

  it("tæller linjer pr. status: beregnet, afventer regel, ikke registreret, aflyst", async () => {
    const { client } = fakeClient({
      partner_fee_line: [
        line({ meeting_id: "m1" }),
        line({ meeting_id: "m2", registered_status: "udeblivelse" }),
        line({ meeting_id: "m3", registered_status: null }),
        line({ meeting_id: "m4", meeting_status: "aflyst" }),
      ],
      fee_rule: [rule],
    });
    const result = await loadFeeTotals(client, period, 1000);
    expect(result.ruleCount).toBe(1);
    expect(result.totals.calculatedCount).toBe(1);
    expect(result.totals.heldCount).toBe(1);
    expect(result.totals.awaitingRuleCount).toBe(1);
    expect(result.totals.notRegisteredCount).toBe(1);
    expect(result.totals.cancelledCount).toBe(1);
    expect(result.totals.totalsByCurrency).toEqual([{ currency: "DKK", amountMinor: 7500 }]);
  });

  it("KASTER ved læsefejl — så overblikket viser '—', ikke et nul", async () => {
    await expect(
      loadFeeTotals(fakeClient({ partner_fee_line: { error: "boom" }, fee_rule: [] }).client, period, 1000),
    ).rejects.toThrow("boom");
    await expect(
      loadFeeTotals(fakeClient({ partner_fee_line: [], fee_rule: { error: "boom" } }).client, period, 1000),
    ).rejects.toThrow("boom");
  });
});
