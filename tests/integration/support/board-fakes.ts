import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BookingProvider,
  BoardEventType,
  BoardEventTypeRequest,
  MultiHostMeetingRequest,
  ScheduledMeeting,
} from "@/lib/booking/port";

/**
 * In-memory Supabase-fake til board-sammensætningen (ADR 0062): nok af PostgREST-kæden til at
 * køre de rigtige skrivestier (`composition`, `board-hosts`, `audit`) uden netværk, og stateful,
 * så testene kan aflæse hvad der faktisk ligger i tabellerne bagefter — ikke kun hvad der blev kaldt.
 * RLS findes ikke her; den dækkes i tests/db/board-change-rls.test.ts.
 */
export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;
/** De tabeller board-testene altid rører — typet som til stede, så de kan læses uden `?.`. */
interface KnownTables {
  board: Row[];
  board_partner: Row[];
  board_change: Row[];
  partner_profile: Row[];
}

export interface FakeDb {
  client: SupabaseClient;
  tables: Tables & KnownTables;
  /** Tabeller der blev rørt, i rækkefølge (til "intet læses før rollen er tjekket"). */
  touched: string[];
  /** Fejl der skal opstå: nøgle `tabel.operation` (select|insert|update|delete) → fejlbesked. */
  failures: Record<string, string | { message: string; code: string }>;
}

const PRIMARY_KEYS: Record<string, string[]> = { board_partner: ["board_id", "partner_id"] };

export function createFakeDb(initial: Tables): FakeDb {
  const tables = {
    board: [],
    board_partner: [],
    board_change: [],
    partner_profile: [],
    ...Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
  } as Tables & KnownTables;
  const db: FakeDb = { client: null as unknown as SupabaseClient, tables, touched: [], failures: {} };
  let nextId = 1;

  db.client = {
    from(table: string) {
      db.touched.push(table);
      const filters: Array<(row: Row) => boolean> = [];
      let operation: "select" | "insert" | "update" | "delete" = "select";
      let payload: Row[] | Row | null = null;
      let returning = false;

      function execute(): { data: Row[] | null; error: { message: string; code?: string } | null } {
        const failure = db.failures[`${table}.${operation}`];
        if (failure) return { data: null, error: typeof failure === "string" ? { message: failure } : failure };
        const rows = (tables[table] ??= []);
        const matches = () => rows.filter((row) => filters.every((f) => f(row)));

        if (operation === "insert") {
          const inserted: Row[] = [];
          for (const raw of payload as Row[]) {
            const row: Row = { id: `gen-${nextId++}`, ...raw };
            const pk = PRIMARY_KEYS[table];
            if (pk && rows.some((r) => pk.every((c) => r[c] === row[c]))) {
              return { data: null, error: { message: "duplicate key", code: "23505" } };
            }
            rows.push(row);
            inserted.push(row);
          }
          return { data: inserted, error: null };
        }
        if (operation === "update") {
          const hit = matches();
          for (const row of hit) Object.assign(row, payload);
          return { data: hit, error: null };
        }
        if (operation === "delete") {
          const hit = matches();
          tables[table] = rows.filter((row) => !hit.includes(row));
          return { data: hit, error: null };
        }
        return { data: matches(), error: null };
      }

      const query: Record<string, unknown> = {
        select: () => {
          returning = true;
          return query;
        },
        insert: (rows: Row | Row[]) => {
          operation = "insert";
          payload = Array.isArray(rows) ? rows : [rows];
          return query;
        },
        update: (patch: Row) => {
          operation = "update";
          payload = patch;
          return query;
        },
        delete: () => {
          operation = "delete";
          return query;
        },
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return query;
        },
        in: (column: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[column]));
          return query;
        },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => {
          const result = execute();
          return { data: result.data?.[0] ?? null, error: result.error };
        },
        single: async () => {
          const result = execute();
          const row = result.data?.[0] ?? null;
          return { data: row, error: result.error ?? (row ? null : { message: "ingen række" }) };
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          const result = execute();
          // En ren insert/update/delete uden .select() returnerer ikke rækker, som i PostgREST.
          const shaped = operation === "select" || returning ? result : { ...result, data: null };
          return Promise.resolve(shaped).then(resolve, reject);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;

  return db;
}

/** Cal.com-fake der husker hvad den blev bedt om, og kan sættes til at fejle. */
export class FakeBookingProvider implements BookingProvider {
  readonly name: string;
  upserts: BoardEventTypeRequest[] = [];
  failWith: Error | null = null;
  nextEventTypeId = 9001;

  constructor(name = "calcom") {
    this.name = name;
  }

  async upsertBoardEventType(req: BoardEventTypeRequest): Promise<BoardEventType> {
    this.upserts.push(req);
    if (this.failWith) throw this.failWith;
    return { eventTypeId: req.eventTypeId ?? this.nextEventTypeId };
  }
  async createMultiHostMeeting(_req: MultiHostMeetingRequest): Promise<ScheduledMeeting> {
    throw new Error("ikke brugt her");
  }
  async rescheduleMeeting(): Promise<ScheduledMeeting> {
    throw new Error("ikke brugt her");
  }
  async cancelMeeting(): Promise<void> {
    throw new Error("ikke brugt her");
  }
  async getMeeting(): Promise<ScheduledMeeting | null> {
    return null;
  }
}

export const IDS = {
  board: "board-1",
  owner: "owner-1",
  admin: "admin-1",
  // Intern lead, intern, ekstern, og to uden for boardet (intern + ekstern).
  anna: "p-anna",
  bo: "p-bo",
  carl: "p-carl",
  dorte: "p-dorte",
  erik: "p-erik",
};

/** Et board med to interne (Anna = lead, Bo) og katalogposter uden for det. */
export function boardTables(overrides: Partial<Tables> = {}): Tables {
  return {
    board: [{ id: IDS.board, name: "[DEMO] Board", owner_id: IDS.owner, calcom_event_type_id: 4242 }],
    board_partner: [
      { board_id: IDS.board, partner_id: IDS.anna, is_lead: true },
      { board_id: IDS.board, partner_id: IDS.bo, is_lead: false },
    ],
    partner_profile: [
      { id: IDS.anna, name: "Anna", is_internal: true, calcom_user_id: 11 },
      { id: IDS.bo, name: "Bo", is_internal: true, calcom_user_id: 12 },
      { id: IDS.carl, name: "Carl", is_internal: false, calcom_user_id: 13 },
      { id: IDS.dorte, name: "Dorte", is_internal: true, calcom_user_id: 14 },
      { id: IDS.erik, name: "Erik", is_internal: false, calcom_user_id: null },
    ],
    board_change: [],
    ...overrides,
  };
}
