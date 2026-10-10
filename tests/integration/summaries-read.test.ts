import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMeetingSummary } from "@/server/summaries";
import { retryMeetingSummary } from "@/server/summaries/actions";

/**
 * Læsevejen og "Generér igen" (B-45, ADR 0059): siden læser den GEMTE række og genererer
 * aldrig; retry er en ejerskabstjekket tilbagestilling af en opgivet række.
 */
type Row = Record<string, unknown>;

const mocked = vi.hoisted(() => ({ client: null as unknown, user: null as unknown, tables: {} as Record<string, Row[]> }));
vi.mock("@/server/auth/supabase-server", () => ({
  createServiceSupabase: () => mocked.client,
  createServerSupabase: async () => mocked.client,
}));
vi.mock("@/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth")>()),
  getCurrentUser: async () => mocked.user,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** from().select().eq()... → maybeSingle / update().eq().select() over in-memory rækker. */
function fakeClient(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let patch: Row | null = null;
      const rows = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
      const query = {
        select: () => query,
        eq(column: string, value: unknown) {
          // `board.owner_id` løses mod det indlejrede board — nok til ejerskabstjekket.
          filters.push((row) => {
            if (column === "board.owner_id") {
              const board = (tables.board ?? []).find((b) => b.id === row.board_id);
              return board?.owner_id === value;
            }
            return row[column] === value;
          });
          return query;
        },
        update(values: Row) {
          patch = values;
          return query;
        },
        async maybeSingle() {
          return { data: rows()[0] ?? null, error: null };
        },
        then(resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) {
          const matched = rows();
          if (patch) for (const row of matched) Object.assign(row, patch);
          return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

const REAL_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  FLAG_AIFOLLOWUP: "true",
  FLAG_TRANSCRIPTION: "true",
  ORDBOGEN_API_KEY: "test-key",
};

describe("getMeetingSummary — læser den gemte række", () => {
  beforeEach(() => {
    mocked.tables = {};
    mocked.client = fakeClient(mocked.tables);
  });
  afterEach(() => vi.restoreAllMocks());

  it("viser det gemte resumé uden at kalde leverandøren (ingen netværkskald ved visning)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mocked.tables.meeting_summary = [
      {
        id: "s-1",
        meeting_id: "m-1",
        status: "klar",
        summary: "Gemt referat.",
        action_items: ["Gør noget"],
        provider: "ordbogen",
      },
    ];

    const state = await getMeetingSummary("m-1", REAL_ENV);

    expect(state).toEqual({ kind: "ready", source: "live", summary: "Gemt referat.", actionItems: ["Gør noget"] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ingen række endnu (rigtige adaptere) → 'på vej', og stadig intet kald til leverandøren", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await getMeetingSummary("m-1", REAL_ENV)).toEqual({ kind: "pending" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("afbilder samtykke-, optagelses- og fejlstatus", async () => {
    for (const [status, kind] of [
      ["mangler_samtykke", "missing_consent"],
      ["mangler_optagelse", "missing_recording"],
      ["fejlet", "failed"],
    ] as const) {
      mocked.tables.meeting_summary = [{ id: "s", meeting_id: "m-1", status, summary: null, action_items: [], provider: null }];
      expect((await getMeetingSummary("m-1", REAL_ENV)).kind).toBe(kind);
    }
  });

  it("demo-tilstand: en gemt række vinder; ellers vises [DEMO]-resuméet direkte uden at gemme noget", async () => {
    const demoEnv = { ...REAL_ENV, FLAG_DEMO: "true", ORDBOGEN_API_KEY: "" };
    const direct = await getMeetingSummary("m-1", demoEnv);
    expect(direct).toMatchObject({ kind: "ready", source: "demo" });
    expect(mocked.tables.meeting_summary).toBeUndefined();

    mocked.tables.meeting_summary = [
      { id: "s", meeting_id: "m-1", status: "klar", summary: "[DEMO] Gemt", action_items: [], provider: "demo" },
    ];
    const stored = await getMeetingSummary("m-1", demoEnv);
    expect(stored).toMatchObject({ kind: "ready", summary: "[DEMO] Gemt" });
  });
});

describe("retryMeetingSummary — Generér igen", () => {
  const OWNER = { id: "owner-1", email: "o@example.test", roles: ["ejer" as const] };

  function form(meetingId: string): FormData {
    const data = new FormData();
    data.set("meeting_id", meetingId);
    return data;
  }

  beforeEach(() => {
    for (const [k, v] of Object.entries(REAL_ENV)) vi.stubEnv(k, v);
    mocked.tables = {
      board: [
        { id: "b-1", owner_id: "owner-1" },
        { id: "b-2", owner_id: "owner-2" },
      ],
      meeting: [
        { id: "m-1", board_id: "b-1" },
        { id: "m-2", board_id: "b-2" },
      ],
      meeting_summary: [
        { id: "s-1", meeting_id: "m-1", status: "fejlet", attempts: 3, error: "TypeError" },
        { id: "s-2", meeting_id: "m-2", status: "fejlet", attempts: 3, error: "TypeError" },
      ],
    };
    mocked.client = fakeClient(mocked.tables);
    mocked.user = OWNER;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sætter ejerens opgivne række tilbage til afventer med nulstillede forsøg — og genererer ikke selv", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await retryMeetingSummary({}, form("m-1"))).toEqual({});
    expect(mocked.tables.meeting_summary?.[0]).toMatchObject({ status: "afventer", attempts: 0, error: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("NEGATIV: en fremmed ejers møde kan ikke tilbagestilles", async () => {
    const result = await retryMeetingSummary({}, form("m-2"));
    expect(result.error).toMatch(/ikke fundet/);
    expect(mocked.tables.meeting_summary?.[1]).toMatchObject({ status: "fejlet", attempts: 3 });
  });

  it("NEGATIV: en partner eller en anonym bruger afvises", async () => {
    mocked.user = { id: "owner-1", email: "p@example.test", roles: ["partner"] };
    expect((await retryMeetingSummary({}, form("m-1"))).error).toMatch(/Adgang nægtet/);
    mocked.user = null;
    expect((await retryMeetingSummary({}, form("m-1"))).error).toMatch(/Adgang nægtet/);
    expect(mocked.tables.meeting_summary?.[0]).toMatchObject({ status: "fejlet" });
  });

  it("kun en opgivet række kan prøves igen — en række i gang røres ikke", async () => {
    (mocked.tables.meeting_summary?.[0] as Row).status = "genereres";
    const result = await retryMeetingSummary({}, form("m-1"));
    expect(result.error).toMatch(/kan ikke genereres igen/);
    expect(mocked.tables.meeting_summary?.[0]).toMatchObject({ status: "genereres", attempts: 3 });
  });
});
