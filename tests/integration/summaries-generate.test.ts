import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/cron/summaries/route";
import { MissingRecordingError, RecordingConsentMissingError } from "@/lib/errors";
import type { LlmProvider } from "@/lib/llm";
import { OrdbogenError } from "@/lib/ordbogen/client";
import type { TranscriptionProvider } from "@/lib/transcription";
import { createLlmProvider } from "@/lib/llm";
import { createTranscriptionProvider } from "@/lib/transcription";
import {
  generatePendingSummaries,
  type SummaryDeps,
} from "@/server/summaries/generate";
import { MAX_ATTEMPTS, STALE_CLAIM_MS } from "@/server/summaries/status";

/**
 * Baggrundsgenereringen af mødeopsummeringer (B-45, ADR 0059) mod en in-memory
 * Supabase-dobbelt og mockede adaptere. Transskriptet i testen er en genkendelig streng, så
 * vi kan bevise at det aldrig havner i rækken eller i loggen.
 */
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const mocked = vi.hoisted(() => ({ service: null as unknown }));
vi.mock("@/server/auth/supabase-server", () => ({
  createServiceSupabase: () => mocked.service,
  createServerSupabase: async () => mocked.service,
}));

/** PostgREST-lignende dobbelt: select/eq/in/is/order/limit/update/upsert (+ .select() efter write). */
function fakeDb(tables: Tables) {
  const client = {
    tables,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let mode: "select" | "update" | "upsert" = "select";
      let patch: Row = {};
      let upsertRows: Row[] = [];
      let orderBy: { column: string; ascending: boolean } | null = null;
      let limitN = Infinity;

      // meeting_summary er et embed på meeting (one-to-one via unique meeting_id).
      const read = (row: Row, column: string): unknown => {
        if (table === "meeting" && column === "meeting_summary") {
          return (tables.meeting_summary ?? []).find((s) => s.meeting_id === row.id) ?? null;
        }
        return row[column] ?? null;
      };

      const matching = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));

      const run = () => {
        if (mode === "upsert") {
          const inserted: Row[] = [];
          for (const input of upsertRows) {
            const existing = tables[table] ?? [];
            if (existing.some((r) => r.meeting_id === input.meeting_id)) continue;
            const row: Row = {
              id: `summary-${existing.length + 1}`,
              status: "afventer",
              attempts: 0,
              action_items: [],
              created_at: `2026-10-10T10:00:${String(existing.length).padStart(2, "0")}Z`,
              updated_at: "2026-10-10T10:00:00Z",
              ...input,
            };
            tables[table] = [...existing, row];
            inserted.push(row);
          }
          return { data: inserted.map((r) => ({ id: r.id })), error: null };
        }
        let rows = matching();
        if (mode === "update") {
          for (const row of rows) Object.assign(row, patch);
          return { data: rows.map((r) => ({ id: r.id })), error: null };
        }
        if (orderBy) {
          const { column, ascending } = orderBy;
          rows = [...rows].sort((a, b) => {
            const l = String(a[column] ?? "");
            const r = String(b[column] ?? "");
            return ascending ? l.localeCompare(r) : r.localeCompare(l);
          });
        }
        return {
          data: rows.slice(0, limitN).map((row) =>
            table === "meeting"
              ? { ...row, meeting_summary: read(row, "meeting_summary") ? [{ id: "x" }] : null }
              : { ...row },
          ),
          error: null,
        };
      };

      const query = {
        select: () => query,
        eq(column: string, value: unknown) {
          filters.push((row) => read(row, column) === value);
          return query;
        },
        in(column: string, values: unknown[]) {
          filters.push((row) => values.includes(read(row, column)));
          return query;
        },
        is(column: string, value: unknown) {
          filters.push((row) => read(row, column) === value);
          return query;
        },
        order(column: string, options?: { ascending?: boolean }) {
          orderBy = { column, ascending: options?.ascending ?? true };
          return query;
        },
        limit(n: number) {
          limitN = n;
          return query;
        },
        update(values: Row) {
          mode = "update";
          patch = values;
          return query;
        },
        upsert(rows: Row[]) {
          mode = "upsert";
          upsertRows = rows;
          return query;
        },
        then(resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return client as unknown as SupabaseClient & { tables: Tables };
}

const NOW = new Date("2026-10-10T12:00:00Z");
const SECRET_TRANSCRIPT = "TRANSSKRIPT-MED-PERSONDATA-42";
const CONSENT = { meetingId: "m-1", registeredAt: "2026-10-01T00:00:00Z" };
const AUDIO = { data: new Uint8Array([1]), filename: "m.mp3", contentType: "audio/mpeg" };

function tables(overrides: Partial<Tables> = {}): Tables {
  return {
    meeting: [
      { id: "m-1", status: "afholdt", starts_at: "2026-10-01T10:00:00Z" },
      { id: "m-2", status: "planlagt", starts_at: "2026-10-20T10:00:00Z" },
    ],
    meeting_summary: [],
    ...overrides,
  };
}

function fakeDeps(over: Partial<SummaryDeps> = {}) {
  const transcribe = vi.fn(async () => ({ text: SECRET_TRANSCRIPT, language: "da-DK" }));
  const summarize = vi.fn(async () => ({ summary: "Et kort referat.", actionItems: ["Gør noget"] }));
  const transcription: TranscriptionProvider = { name: "fake", transcribe };
  const llm: LlmProvider = { name: "fake-llm", model: "fake-model-1", summarizeMeeting: summarize };
  const getConsent = vi.fn(async () => CONSENT as typeof CONSENT | null);
  const loadRecording = vi.fn(async () => AUDIO as typeof AUDIO | null);
  const report = vi.fn(async () => {});
  const deps: SummaryDeps = { transcription, llm, getConsent, loadRecording, report, ...over };
  return { deps, transcribe, summarize, getConsent, loadRecording, report };
}

function summaryOf(db: ReturnType<typeof fakeDb>, meetingId = "m-1"): Row {
  const row = db.tables.meeting_summary?.find((r) => r.meeting_id === meetingId);
  if (!row) throw new Error(`ingen opsummeringsrække for ${meetingId}`);
  return row;
}

describe("generatePendingSummaries — baggrundsgenerering", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("køer kun AFHOLDTE møder, genererer, gemmer resumé + audit — og gemmer ikke transskriptet", async () => {
    const db = fakeDb(tables());
    const { deps, transcribe, summarize } = fakeDeps();

    const result = await generatePendingSummaries(db, NOW, 3, deps);

    expect(result).toMatchObject({ enqueued: 1, generated: 1, failed: 0, notConfigured: false });
    expect(db.tables.meeting_summary).toHaveLength(1); // det planlagte møde fik ingen række
    const row = summaryOf(db);
    expect(row).toMatchObject({
      status: "klar",
      summary: "Et kort referat.",
      action_items: ["Gør noget"],
      provider: "fake-llm",
      model: "fake-model-1",
      error: null,
      attempts: 1,
      generated_at: NOW.toISOString(),
    });
    // Transskriptet blev sendt videre til LLM'en, men ligger ingen steder i rækken.
    expect(summarize).toHaveBeenCalledWith({ meetingId: "m-1", transcript: SECRET_TRANSCRIPT });
    expect(JSON.stringify(row)).not.toContain(SECRET_TRANSCRIPT);
    // Samtykke og lyd følger med transskriptionen.
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ consent: CONSENT, audio: AUDIO }));
  });

  it("🔴 uden samtykke: INGEN optagelse hentes, INGEN transskription, INGEN LLM — rækken står som mangler_samtykke", async () => {
    const db = fakeDb(tables());
    const { deps, transcribe, summarize, loadRecording } = fakeDeps({ getConsent: vi.fn(async () => null) });

    const result = await generatePendingSummaries(db, NOW, 3, deps);

    expect(result).toMatchObject({ generated: 0, missingConsent: 1 });
    expect(summaryOf(db)).toMatchObject({ status: "mangler_samtykke", attempts: 0 });
    expect(loadRecording).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  });

  it("en blokeret række tjekkes igen uden at skrive, og genereres når samtykket dukker op", async () => {
    const db = fakeDb(tables());
    const getConsent = vi.fn(async () => null as typeof CONSENT | null);
    const { deps, transcribe } = fakeDeps({ getConsent });

    await generatePendingSummaries(db, NOW, 3, deps);
    const stamp = summaryOf(db).updated_at;
    const later = new Date(NOW.getTime() + 15 * 60_000);
    await generatePendingSummaries(db, later, 3, deps);
    expect(summaryOf(db).updated_at).toBe(stamp); // ingen skrivestorm
    expect(transcribe).not.toHaveBeenCalled();

    getConsent.mockResolvedValue(CONSENT);
    const result = await generatePendingSummaries(db, later, 3, deps);
    expect(result.generated).toBe(1);
    expect(summaryOf(db).status).toBe("klar");
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("samtykke men ingen optagelse → mangler_optagelse, ingen transskription", async () => {
    const db = fakeDb(tables());
    const { deps, transcribe } = fakeDeps({ loadRecording: vi.fn(async () => null) });

    const result = await generatePendingSummaries(db, NOW, 3, deps);

    expect(result).toMatchObject({ generated: 0, missingRecording: 1 });
    expect(summaryOf(db).status).toBe("mangler_optagelse");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("adapterens egen fejl-lukket-afvisning er en tilstand, ikke et brændt forsøg", async () => {
    const db = fakeDb(tables());
    const { deps } = fakeDeps();
    deps.transcription.transcribe = vi.fn(async () => {
      throw new RecordingConsentMissingError("m-1");
    });

    await generatePendingSummaries(db, NOW, 3, deps);
    expect(summaryOf(db)).toMatchObject({ status: "mangler_samtykke", attempts: 0 });

    const db2 = fakeDb(tables());
    const second = fakeDeps();
    second.deps.transcription.transcribe = vi.fn(async () => {
      throw new MissingRecordingError("m-1");
    });
    await generatePendingSummaries(db2, NOW, 3, second.deps);
    expect(summaryOf(db2)).toMatchObject({ status: "mangler_optagelse", attempts: 0 });
  });

  it("er idempotent: en færdig række genereres ikke igen", async () => {
    const db = fakeDb(tables());
    const { deps, transcribe, summarize } = fakeDeps();

    await generatePendingSummaries(db, NOW, 3, deps);
    const again = await generatePendingSummaries(db, NOW, 3, deps);

    expect(again).toMatchObject({ enqueued: 0, generated: 0 });
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(db.tables.meeting_summary).toHaveLength(1);
  });

  it("er idempotent under samtidige kørsler: kun én vinder låsen og kalder leverandøren", async () => {
    const db = fakeDb(tables());
    const { deps, transcribe, summarize } = fakeDeps();

    const [a, b] = await Promise.all([
      generatePendingSummaries(db, NOW, 3, deps),
      generatePendingSummaries(db, NOW, 3, deps),
    ]);

    expect(a.generated + b.generated).toBe(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(db.tables.meeting_summary).toHaveLength(1);
    expect(summaryOf(db)).toMatchObject({ status: "klar", attempts: 1 });
  });

  it("en fejl tæller som forsøg og lægger rækken tilbage; efter MAX_ATTEMPTS er den fejlet og rapporteret", async () => {
    const db = fakeDb(tables());
    const { deps, report } = fakeDeps();
    deps.llm.summarizeMeeting = vi.fn(async () => {
      throw new OrdbogenError("summarizeMeeting", `modellen citerede: ${SECRET_TRANSCRIPT}`, 502);
    });

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      const result = await generatePendingSummaries(db, NOW, 3, deps);
      expect(result.failed).toBe(1);
      expect(summaryOf(db)).toMatchObject({
        status: "afventer",
        attempts: attempt,
        error: "OrdbogenError:summarizeMeeting:HTTP502",
      });
    }
    expect(report).not.toHaveBeenCalled();

    await generatePendingSummaries(db, NOW, 3, deps);
    expect(summaryOf(db)).toMatchObject({ status: "fejlet", attempts: MAX_ATTEMPTS });
    expect(report).toHaveBeenCalledTimes(1);

    // Opgivet: kørslen rører den ikke mere (det koster ikke en betalt transskription hver gang).
    const calls = (deps.llm.summarizeMeeting as ReturnType<typeof vi.fn>).mock.calls.length;
    await generatePendingSummaries(db, NOW, 3, deps);
    expect((deps.llm.summarizeMeeting as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);

    // Hverken række eller log indeholder transskript/fejltekst.
    expect(JSON.stringify(db.tables.meeting_summary)).not.toContain(SECRET_TRANSCRIPT);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(SECRET_TRANSCRIPT);
    expect(JSON.stringify(report.mock.calls)).not.toContain(SECRET_TRANSCRIPT);
  });

  it("overtager en forældet 'genereres'-lås (død kørsel), men ikke en frisk", async () => {
    const stale = new Date(NOW.getTime() - STALE_CLAIM_MS).toISOString();
    const fresh = new Date(NOW.getTime() - 60_000).toISOString();
    const db = fakeDb(
      tables({
        meeting: [
          { id: "m-1", status: "afholdt", starts_at: "2026-10-01T10:00:00Z" },
          { id: "m-3", status: "afholdt", starts_at: "2026-10-02T10:00:00Z" },
        ],
        meeting_summary: [
          { id: "s-1", meeting_id: "m-1", status: "genereres", attempts: 1, created_at: "a", updated_at: stale },
          { id: "s-3", meeting_id: "m-3", status: "genereres", attempts: 1, created_at: "b", updated_at: fresh },
        ],
      }),
    );
    const { deps, transcribe } = fakeDeps();

    await generatePendingSummaries(db, NOW, 3, deps);

    expect(summaryOf(db, "m-1")).toMatchObject({ status: "klar", attempts: 2 });
    expect(summaryOf(db, "m-3")).toMatchObject({ status: "genereres", attempts: 1 });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("behandler højst `limit` møder pr. kørsel", async () => {
    const meetings = ["m-1", "m-2", "m-3"].map((id, i) => ({
      id,
      status: "afholdt",
      starts_at: `2026-10-0${i + 1}T10:00:00Z`,
    }));
    const db = fakeDb(tables({ meeting: meetings }));
    const { deps, transcribe } = fakeDeps();

    const first = await generatePendingSummaries(db, NOW, 2, deps);
    expect(first.generated).toBe(2);
    const second = await generatePendingSummaries(db, NOW, 2, deps);
    expect(second.generated).toBe(1);
    expect(transcribe).toHaveBeenCalledTimes(3);
  });

  it("rører intet når en port er en stub (synligt hul, ingen brændte forsøg)", async () => {
    const db = fakeDb(tables());
    const stubDeps = fakeDeps({
      transcription: createTranscriptionProvider({}),
      llm: createLlmProvider({}),
    });

    const result = await generatePendingSummaries(db, NOW, 3, stubDeps.deps);

    expect(result.notConfigured).toBe(true);
    expect(db.tables.meeting_summary).toHaveLength(0);
    expect(stubDeps.getConsent).not.toHaveBeenCalled();
  });

  it("demo-stien: begge porte demo → [DEMO]-resumé uden at røre samtykke eller optagelse", async () => {
    const db = fakeDb(tables());
    const env = { FLAG_DEMO: "true" };
    const { deps, getConsent, loadRecording } = fakeDeps({
      transcription: createTranscriptionProvider(env),
      llm: createLlmProvider(env),
    });

    const result = await generatePendingSummaries(db, NOW, 3, deps);

    expect(result.generated).toBe(1);
    expect(getConsent).not.toHaveBeenCalled();
    expect(loadRecording).not.toHaveBeenCalled();
    const row = summaryOf(db);
    expect(row).toMatchObject({ status: "klar", provider: "demo" });
    expect(String(row.summary).startsWith("[DEMO]")).toBe(true);
  });

  it("🔴 demo skygger ikke for samtykket: demo-transskription med en ægte LLM kræver stadig samtykke", async () => {
    const db = fakeDb(tables());
    const demoTranscription = createTranscriptionProvider({ FLAG_DEMO: "true" });
    expect(demoTranscription.name).toBe("demo");
    const { deps, summarize } = fakeDeps({
      transcription: demoTranscription,
      getConsent: vi.fn(async () => null),
    });

    await generatePendingSummaries(db, NOW, 3, deps);

    expect(summaryOf(db).status).toBe("mangler_samtykke");
    expect(summarize).not.toHaveBeenCalled();
  });
});

describe("/api/cron/summaries — aldrig åben uden hemmelighed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function call(secret?: string): Promise<Response> {
    return POST(
      new Request("http://localhost/api/cron/summaries", {
        method: "POST",
        headers: secret ? { "x-cron-secret": secret } : {},
      }),
    );
  }

  function stubSupabase() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
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

  it("med korrekt hemmelighed men FLAG_AIFOLLOWUP slået fra gøres intet", async () => {
    const db = fakeDb(tables());
    mocked.service = db;
    vi.stubEnv("CRON_SECRET", "rigtig");
    vi.stubEnv("FLAG_AIFOLLOWUP", "");
    stubSupabase();

    const response = await call("rigtig");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ skipped: "FLAG_AIFOLLOWUP er slået fra." });
    expect(db.tables.meeting_summary).toHaveLength(0);
  });

  it("med flag tændt men porte der stadig er stubs → 503 (synligt hul), uden at røre rækker", async () => {
    const db = fakeDb(tables());
    mocked.service = db;
    vi.stubEnv("CRON_SECRET", "rigtig");
    vi.stubEnv("FLAG_AIFOLLOWUP", "true");
    vi.stubEnv("FLAG_DEMO", "");
    vi.stubEnv("FLAG_TRANSCRIPTION", "");
    vi.stubEnv("ORDBOGEN_API_KEY", "");
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("TRANSCRIPTION_API_KEY", "");
    stubSupabase();

    const response = await call("rigtig");

    expect(response.status).toBe(503);
    expect(db.tables.meeting_summary).toHaveLength(0);
  });

  it("med flag tændt og demo-porte genererer den (idempotent ved dobbeltaflevering)", async () => {
    const db = fakeDb(tables());
    mocked.service = db;
    vi.stubEnv("CRON_SECRET", "rigtig");
    vi.stubEnv("FLAG_AIFOLLOWUP", "true");
    vi.stubEnv("FLAG_DEMO", "true");
    vi.stubEnv("ORDBOGEN_API_KEY", "");
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("TRANSCRIPTION_API_KEY", "");
    stubSupabase();

    const response = await call("rigtig");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enqueued: 1, generated: 1 });
    expect(summaryOf(db)).toMatchObject({ status: "klar", provider: "demo" });

    const again = await (await call("rigtig")).json();
    expect(again).toMatchObject({ enqueued: 0, generated: 0 });
    expect(db.tables.meeting_summary).toHaveLength(1);
  });

  it("med flag, men uden Supabase-konfiguration → 503", async () => {
    vi.stubEnv("CRON_SECRET", "rigtig");
    vi.stubEnv("FLAG_AIFOLLOWUP", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await call("rigtig")).status).toBe(503);
  });
});
