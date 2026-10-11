import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { NotConfiguredError, ProviderError } from "@/lib/errors";
import type { ProcessorEraser } from "@/lib/erasure";
import type { AuthUser } from "@/server/auth";
import type { RowFetcher, RowQuery } from "@/server/admin/subject-collect";
import { executeErasure, subjectHash, type ErasureDeps } from "@/server/erasure/execute";
import { readErasureFacts } from "@/server/erasure/plan";
import { requestErasure, requestErasurePreview } from "@/server/erasure/request";
import { boardTables, createFakeDb, FakeBookingProvider, IDS, type FakeDb, type Row, type Tables } from "./support/board-fakes";

/**
 * Sletningens orkestrering (ADR 0068) mod en stateful fake af Supabase. Funktionen `erase_data_subject`
 * selv (transaktion, fail-closed, invarianter, revoke) prøves mod rigtig Postgres i tests/db/erasure.test.ts;
 * her er det rækkefølgen og følgevirkningerne der prøves:
 *   - admin FØR noget andet (ingen afhængigheder bygges for en ikke-admin),
 *   - blokeringer (opbevaringspligt, B-68) afviser FØR noget skrives,
 *   - en ekstern behandlers fejl ruller IKKE Supabase-sletningen tilbage, men registreres, og Auth-kontoen
 *     bevares så sletningen kan genkøres,
 *   - kvitteringen indeholder ingen persondata.
 */

const ADMIN_ID = "00000000-0000-0000-0000-0000000000a0";
const OWNER = "00000000-0000-0000-0000-0000000000a1";
const PARTNER_USER = "00000000-0000-0000-0000-0000000000a2";
const ADMIN2 = "00000000-0000-0000-0000-0000000000a3";
const OWNER_EMAIL = "eva.ejer@example.invalid";
const PARTNER_EMAIL = "carl.partner@example.invalid";

const admin: AuthUser = { id: ADMIN_ID, email: "admin@example.invalid", roles: ["admin"] };
const owner: AuthUser = { id: OWNER, email: OWNER_EMAIL, roles: ["ejer"] };
const partner: AuthUser = { id: PARTNER_USER, email: PARTNER_EMAIL, roles: ["partner"] };

function tables(overrides: Partial<Tables> = {}): Tables {
  return boardTables({
    app_user: [
      { id: ADMIN_ID, email: "admin@example.invalid" },
      { id: ADMIN2, email: "admin2@example.invalid" },
      { id: OWNER, email: OWNER_EMAIL, display_name: "[DEMO] Eva", phone_e164: null },
      { id: PARTNER_USER, email: PARTNER_EMAIL, display_name: "[DEMO] Carl", phone_e164: null },
    ],
    user_role_assignment: [
      { user_id: ADMIN_ID, role: "admin" },
      { user_id: ADMIN2, role: "admin" },
      { user_id: OWNER, role: "ejer" },
      { user_id: PARTNER_USER, role: "partner" },
    ],
    // Carl (ekstern) sidder på boardet som tredje partner og er koblet til partner-user.
    board_partner: [
      { board_id: IDS.board, partner_id: IDS.anna, is_lead: true },
      { board_id: IDS.board, partner_id: IDS.bo, is_lead: false },
      { board_id: IDS.board, partner_id: IDS.carl, is_lead: false },
    ],
    partner_profile: [
      { id: IDS.anna, name: "Anna", is_internal: true, calcom_user_id: 11, app_user_id: null },
      { id: IDS.bo, name: "Bo", is_internal: true, calcom_user_id: 12, app_user_id: null },
      { id: IDS.carl, name: "Carl", is_internal: false, calcom_user_id: 13, app_user_id: PARTNER_USER },
    ],
    meeting: [],
    membership: [],
    payment_charge: [],
    meeting_partner: [],
    ...overrides,
  });
}

/** Fetcher over de samme (live) tabeller som service-klienten — filtrerer som PostgREST ville. */
function fetcherOver(db: FakeDb): { fetch: RowFetcher; queries: RowQuery[] } {
  const queries: RowQuery[] = [];
  const fetch: RowFetcher = async (query) => {
    queries.push(query);
    let rows: Row[] = db.tables[query.table] ?? [];
    if (query.eq) rows = rows.filter((r) => r[query.eq!.column] === query.eq!.value);
    if (query.in) rows = rows.filter((r) => query.in!.values.includes(r[query.in!.column] as string));
    const columns = query.columns.split(",").map((c) => c.trim());
    return rows.map((r) => Object.fromEntries(columns.filter((c) => c in r).map((c) => [c, r[c]])));
  };
  return { fetch, queries };
}

class RecordingBooking extends FakeBookingProvider {
  cancelled: string[] = [];
  cancelFailure: Error | null = null;
  override async cancelMeeting(uid?: string): Promise<void> {
    if (this.cancelFailure) throw this.cancelFailure;
    this.cancelled.push(String(uid));
  }
}

class FakeEraser implements ProcessorEraser {
  calls: Array<{ userId: string; email: string }> = [];
  failWith: Error | null = null;
  constructor(
    readonly processor: "posthog" | "resend",
    readonly name = "fake",
  ) {}
  async eraseDataSubject(subject: { userId: string; email: string }) {
    this.calls.push(subject);
    if (this.failWith) throw this.failWith;
    return { status: "slettet" as const, reference: null };
  }
}

interface Harness {
  db: FakeDb;
  deps: ErasureDeps;
  rpc: ReturnType<typeof vi.fn>;
  deleteUser: ReturnType<typeof vi.fn>;
  booking: RecordingBooking;
  posthog: FakeEraser;
  resend: FakeEraser;
  makeDeps: Mock<() => ErasureDeps>;
}

function harness(initial: Tables = tables(), options: { rpcError?: { message: string } } = {}): Harness {
  const db = createFakeDb(initial);
  const { fetch } = fetcherOver(db);
  const booking = new RecordingBooking();
  const posthog = new FakeEraser("posthog");
  const resend = new FakeEraser("resend");
  const innerRpc = db.client.rpc.bind(db.client);
  let changeSeq = 0;

  // `erase_data_subject` i fake'en: noterer kaldet, fjerner partnerne via boardets sammensætning og
  // blanker kontoen — nok til at orkestreringen kan følges. Det rigtige indhold prøves mod Postgres.
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn !== "erase_data_subject") return innerRpc(fn, args);
    if (options.rpcError) return { data: null, error: options.rpcError };
    const userId = args.p_user_id as string;
    const removals = args.p_board_removals as Array<{ board_id: string; partner_id: string }>;
    const changes = removals.map((r) => {
      const change_id = `change-${++changeSeq}`;
      db.tables.board_partner = db.tables.board_partner.filter((m) => !(m.board_id === r.board_id && m.partner_id === r.partner_id));
      db.tables.board_change.push({ id: change_id, board_id: r.board_id, action: "fjern", calcom_sync: "fejlet" });
      return { board_id: r.board_id, change_id };
    });
    db.tables.board = db.tables.board.filter((b) => b.owner_id !== userId);
    db.tables.partner_profile = db.tables.partner_profile.filter((p) => p.app_user_id !== userId);
    db.tables.user_role_assignment = rowsOf(db, "user_role_assignment").filter((r) => r.user_id !== userId);
    for (const u of rowsOf(db, "app_user")) if (u.id === userId) Object.assign(u, { display_name: null, phone_e164: null });
    return { data: { deleted: { board: 1, board_change_actor: 0 }, board_changes: changes }, error: null };
  });
  (db.client as unknown as { rpc: unknown }).rpc = rpc;

  // Auth-sletningen fjerner ankeret via triggeren (0004) — her gør fake'en det direkte.
  const deleteUser = vi.fn(async (userId: string) => {
    db.tables.app_user = rowsOf(db, "app_user").filter((u) => u.id !== userId);
    return { error: null };
  });
  const deps: ErasureDeps = {
    service: db.client,
    fetchRows: fetch,
    authAdmin: { deleteUser },
    erasers: [posthog, resend],
    booking,
    now: () => new Date("2026-10-11T12:00:00Z"),
  };
  const makeDeps = vi.fn<() => ErasureDeps>(() => deps);
  return { db, deps, rpc, deleteUser, booking, posthog, resend, makeDeps };
}

afterEach(() => vi.restoreAllMocks());

/** En tabel som liste — fake-databasen opretter tabeller ved første brug. */
function rowsOf(db: FakeDb, table: string): Row[] {
  return db.tables[table] ?? [];
}

function receiptRow(h: Harness): Row {
  const rows = rowsOf(h.db, "erasure_receipt");
  expect(rows).toHaveLength(1);
  return rows[0] as Row;
}

describe("sletning er admin-only — rollen kommer fra sessionen, og ingen klient bygges før den er tjekket", () => {
  const cases: Array<[string, AuthUser | null, string]> = [
    ["anonym", null, "ikke-logget-ind"],
    ["ejer (også sin EGEN sletning)", owner, "ikke-admin"],
    ["partner", partner, "ikke-admin"],
  ];

  for (const [label, user, code] of cases) {
    it(`NEGATIV: ${label} får ${code} — preview og sletning bygger aldrig afhængigheder`, async () => {
      const h = harness();
      const preview = await requestErasurePreview({ user, email: OWNER_EMAIL, makeDeps: h.makeDeps });
      expect(preview).toMatchObject({ ok: false, code });
      const result = await requestErasure({ user, userId: OWNER, confirmEmail: OWNER_EMAIL, makeDeps: h.makeDeps });
      expect(result).toMatchObject({ ok: false, code });
      expect(h.makeDeps).not.toHaveBeenCalled();
      expect(h.rpc).not.toHaveBeenCalled();
      expect(h.deleteUser).not.toHaveBeenCalled();
      expect(h.db.touched).toEqual([]);
    });
  }

  it("NEGATIV: ugyldig e-mail og ugyldigt id afvises før afhængigheder bygges", async () => {
    const h = harness();
    expect(await requestErasurePreview({ user: admin, email: "ikke-en-adresse", makeDeps: h.makeDeps })).toMatchObject({
      ok: false,
      code: "ugyldig-email",
    });
    expect(await requestErasure({ user: admin, userId: "ikke-et-uuid", confirmEmail: OWNER_EMAIL, makeDeps: h.makeDeps })).toMatchObject({
      ok: false,
      code: "ugyldigt-id",
    });
    expect(h.makeDeps).not.toHaveBeenCalled();
  });
});

describe("preview (trin 1) skriver intet", () => {
  it("returnerer planen for en ejer uden betalingsdata og rører ikke databasen med skrivninger", async () => {
    const h = harness(tables({ board: [{ id: IDS.board, name: "[DEMO] Board", owner_id: OWNER, calcom_event_type_id: 4242 }] }));
    const result = await requestErasurePreview({ user: admin, email: ` ${OWNER_EMAIL.toUpperCase()} `, makeDeps: h.makeDeps });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.executable).toBe(true);
    expect(result.plan.userId).toBe(OWNER);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.posthog.calls).toEqual([]);
    expect(JSON.stringify(result.plan)).not.toContain(OWNER_EMAIL);
  });

  it("ukendt e-mail → ikke-fundet", async () => {
    const h = harness();
    expect(await requestErasurePreview({ user: admin, email: "ingen@example.invalid", makeDeps: h.makeDeps })).toMatchObject({
      ok: false,
      code: "ikke-fundet",
    });
  });
});

describe("blokeringer afviser FØR noget skrives (fail-closed)", () => {
  it("NEGATIV: en ejer med et medlemskab kan ikke slettes — hverken rpc, eksterne eller Auth kaldes", async () => {
    const h = harness(
      tables({
        board: [{ id: IDS.board, name: "[DEMO] Board", owner_id: OWNER, calcom_event_type_id: 4242 }],
        membership: [{ id: "ms1", board_id: IDS.board }],
      }),
    );
    const result = await requestErasure({ user: admin, userId: OWNER, confirmEmail: OWNER_EMAIL, makeDeps: h.makeDeps });
    expect(result).toMatchObject({ ok: false, code: "blokeret" });
    expect(!result.ok && result.message).toMatch(/Afventer afklaring af opbevaringspligt \(TODO\(ejer\/jura\)\)/);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.posthog.calls).toEqual([]);
    expect(h.resend.calls).toEqual([]);
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(rowsOf(h.db, "erasure_receipt")).toEqual([]);
    expect(rowsOf(h.db, "app_user").some((u) => u.id === OWNER)).toBe(true);
  });

  it("NEGATIV: betalingstræk på et medlemskab blokerer også", async () => {
    const h = harness(
      tables({
        board: [{ id: IDS.board, name: "B", owner_id: OWNER, calcom_event_type_id: null }],
        membership: [{ id: "ms1", board_id: IDS.board }],
        payment_charge: [{ id: "c1", membership_id: "ms1" }],
      }),
    );
    const preview = await requestErasurePreview({ user: admin, email: OWNER_EMAIL, makeDeps: h.makeDeps });
    expect(preview.ok && preview.plan.blockers[0]?.message).toMatch(/1 medlemskab, 1 betalingstræk/);
  });

  it("NEGATIV (B-68): en partner hvis fjernelse efterlader boardet under to partnere, blokeres — og boardet nævnes", async () => {
    const h = harness(
      tables({
        board_partner: [
          { board_id: IDS.board, partner_id: IDS.anna, is_lead: true },
          { board_id: IDS.board, partner_id: IDS.carl, is_lead: false },
        ],
      }),
    );
    const result = await requestErasure({ user: admin, userId: PARTNER_USER, confirmEmail: PARTNER_EMAIL, makeDeps: h.makeDeps });
    expect(result).toMatchObject({ ok: false, code: "blokeret" });
    if (result.ok) return;
    expect(result.plan?.blockers[0]).toMatchObject({
      code: "board-invariant",
      boards: [{ id: IDS.board, name: "[DEMO] Board", reason: "Et board skal bestå af 2-3 partnere." }],
    });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.db.tables.partner_profile.some((p) => p.id === IDS.carl)).toBe(true);
  });

  it("NEGATIV: en admin kan ikke slette sig selv", async () => {
    const h = harness();
    const result = await requestErasure({ user: admin, userId: ADMIN_ID, confirmEmail: "admin@example.invalid", makeDeps: h.makeDeps });
    expect(result).toMatchObject({ ok: false, code: "blokeret" });
    expect(!result.ok && result.plan?.blockers.map((b) => b.code)).toContain("selv");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("NEGATIV: den sidste admin kan ikke slettes", async () => {
    const h = harness(tables({ user_role_assignment: [{ user_id: OWNER, role: "admin" }] }));
    const result = await requestErasure({ user: admin, userId: OWNER, confirmEmail: OWNER_EMAIL, makeDeps: h.makeDeps });
    expect(result).toMatchObject({ ok: false, code: "blokeret" });
    expect(!result.ok && result.plan?.blockers.map((b) => b.code)).toEqual(["sidste-admin"]);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("NEGATIV: en forkert bekræftet e-mail sletter intet", async () => {
    const h = harness();
    const result = await requestErasure({ user: admin, userId: OWNER, confirmEmail: "en.anden@example.invalid", makeDeps: h.makeDeps });
    expect(result).toMatchObject({ ok: false, code: "email-matcher-ikke" });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("sidste værn: opbevaringspligt i funktionen (et løb efter planen) giver 'blokeret', ikke et tomt svar", async () => {
    const h = harness(tables(), { rpcError: { message: "opbevaringspligt: personen har betalingsdata" } });
    const result = await requestErasure({ user: admin, userId: OWNER, confirmEmail: OWNER_EMAIL, makeDeps: h.makeDeps });
    expect(result).toMatchObject({ ok: false, code: "blokeret" });
    expect(!result.ok && result.message).toMatch(/Intet er slettet/);
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.posthog.calls).toEqual([]);
  });

  it("en anden databasefejl giver 'fejlet' og efterlader alt — Auth og eksterne røres ikke", async () => {
    const h = harness(tables(), { rpcError: { message: "Boardet blev ændret af en anden imens — genindlæs og prøv igen." } });
    const result = await requestErasure({ user: admin, userId: OWNER, confirmEmail: OWNER_EMAIL, makeDeps: h.makeDeps });
    expect(result).toMatchObject({ ok: false, code: "fejlet" });
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.resend.calls).toEqual([]);
  });
});

describe("en vellykket sletning af en ejer", () => {
  it("rækkefølge: Supabase → eksterne → Auth → kvittering; planen sendes til funktionen", async () => {
    const h = harness(tables({ board: [{ id: IDS.board, name: "B", owner_id: OWNER, calcom_event_type_id: null }] }));
    const order: string[] = [];
    h.rpc.mockImplementationOnce(async () => {
      order.push("rpc");
      return { data: { deleted: { board: 1, board_change_actor: 0 }, board_changes: [] }, error: null };
    });
    h.posthog.eraseDataSubject = async (s) => (order.push("posthog"), h.posthog.calls.push(s), { status: "slettet" as const, reference: null });
    h.deleteUser.mockImplementationOnce(async () => (order.push("auth"), { error: null }));

    const result = await requestErasure({ user: admin, userId: OWNER, confirmEmail: ` ${OWNER_EMAIL.toUpperCase()} `, makeDeps: h.makeDeps });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(order).toEqual(["rpc", "posthog", "auth"]);
    expect(h.rpc).toHaveBeenCalledWith("erase_data_subject", { p_user_id: OWNER, p_actor_id: ADMIN_ID, p_board_removals: [] });
    // Resend får e-mailen (normaliseret), PostHog bruger-id'et.
    expect(h.resend.calls).toEqual([{ userId: OWNER, email: OWNER_EMAIL }]);
    expect(result.receipt.outcome).toBe("gennemfoert");
    expect(result.receipt.systems.map((s) => [s.system, s.status])).toEqual([
      ["supabase", "slettet"],
      ["posthog", "slettet"],
      ["resend", "slettet"],
      ["supabase-auth", "slettet"],
    ]);
    expect(result.receipt.missing).toEqual([]);
  });

  it("kvitteringen er pseudonym: id-hash, admin og systemer — ingen e-mail, intet navn, intet bruger-id", async () => {
    const h = harness(tables({ board: [{ id: IDS.board, name: "B", owner_id: OWNER, calcom_event_type_id: null }] }));
    const result = await requestErasure({ user: admin, userId: OWNER, confirmEmail: OWNER_EMAIL, makeDeps: h.makeDeps });
    expect(result.ok && result.receipt.receiptSaved).toBe(true);
    const row = receiptRow(h);
    expect(row).toMatchObject({ subject_hash: subjectHash(OWNER), requested_by: ADMIN_ID, outcome: "gennemfoert" });
    const serialised = JSON.stringify(row);
    for (const secret of [OWNER_EMAIL, "Eva", OWNER, "ejer@", "@example"]) {
      expect(serialised, secret).not.toContain(secret);
    }
  });

  it("idempotent: en genkørsel efter en gennemført sletning er 'ikke-fundet' og kalder intet", async () => {
    const h = harness(tables({ board: [{ id: IDS.board, name: "B", owner_id: OWNER, calcom_event_type_id: null }] }));
    await requestErasure({ user: admin, userId: OWNER, confirmEmail: OWNER_EMAIL, makeDeps: h.makeDeps });
    h.rpc.mockClear();
    h.deleteUser.mockClear();
    h.posthog.calls = [];
    const again = await requestErasure({ user: admin, userId: OWNER, confirmEmail: OWNER_EMAIL, makeDeps: h.makeDeps });
    expect(again).toMatchObject({ ok: false, code: "ikke-fundet" });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.posthog.calls).toEqual([]);
    expect(rowsOf(h.db, "erasure_receipt")).toHaveLength(1);
  });

  it("kommende bookinger aflyses hos Cal.com; tidligere bookinger står som manuelt hul", async () => {
    const h = harness(
      tables({
        board: [{ id: IDS.board, name: "B", owner_id: OWNER, calcom_event_type_id: 4242 }],
        meeting: [
          { id: "m1", board_id: IDS.board, status: "planlagt", starts_at: "2026-12-01T10:00:00Z", provider_booking_uid: "uid-fremtid" },
          { id: "m2", board_id: IDS.board, status: "afholdt", starts_at: "2026-01-01T10:00:00Z", provider_booking_uid: "uid-fortid" },
        ],
      }),
    );
    const result = await executeErasure(h.deps, { adminId: ADMIN_ID, userId: OWNER, confirmEmail: OWNER_EMAIL });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(h.booking.cancelled).toEqual(["uid-fremtid"]);
    const calcom = result.receipt.systems.find((s) => s.system === "calcom");
    expect(calcom).toMatchObject({ status: "manuel" });
    expect(calcom?.detail).toMatch(/1 af 1 kommende bookinger aflyst/);
    expect(result.receipt.missing).toContain("calcom");
    // Et manuelt hul er ikke en fejl: Auth-kontoen slettes stadig.
    expect(result.receipt.outcome).toBe("gennemfoert");
  });
});

describe("ekstern fejl ruller IKKE Supabase-sletningen tilbage — men registreres, og sletningen kan genkøres", () => {
  it("PostHog fejler: Supabase-delen står, Auth-kontoen bevares, kvitteringen siger 'delvist' og hvad der mangler", async () => {
    const h = harness(tables({ board: [{ id: IDS.board, name: "B", owner_id: OWNER, calcom_event_type_id: null }] }));
    h.posthog.failWith = new ProviderError("PostHog", "eraseDataSubject", 500, "", true);
    const result = await executeErasure(h.deps, { adminId: ADMIN_ID, userId: OWNER, confirmEmail: OWNER_EMAIL });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.db.tables.board.some((b) => b.owner_id === OWNER)).toBe(false); // Supabase er slettet
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(rowsOf(h.db, "app_user").some((u) => u.id === OWNER)).toBe(true); // ankeret består
    expect(result.receipt.outcome).toBe("delvist");
    expect(result.receipt.missing).toEqual(expect.arrayContaining(["posthog", "supabase-auth"]));
    expect(result.receipt.systems.find((s) => s.system === "posthog")).toMatchObject({ status: "fejlet" });
    expect(result.receipt.systems.find((s) => s.system === "resend")).toMatchObject({ status: "slettet" });
    expect(receiptRow(h).outcome).toBe("delvist");
  });

  it("genkørsel: PostHog er oppe igen → kontoen slettes, og en ny kvittering skrives", async () => {
    const h = harness(tables({ board: [{ id: IDS.board, name: "B", owner_id: OWNER, calcom_event_type_id: null }] }));
    h.posthog.failWith = new ProviderError("PostHog", "eraseDataSubject", 500, "", true);
    await executeErasure(h.deps, { adminId: ADMIN_ID, userId: OWNER, confirmEmail: OWNER_EMAIL });

    h.posthog.failWith = null;
    const retry = await executeErasure(h.deps, { adminId: ADMIN_ID, userId: OWNER, confirmEmail: OWNER_EMAIL });
    expect(retry.ok && retry.receipt.outcome).toBe("gennemfoert");
    expect(h.deleteUser).toHaveBeenCalledTimes(1);
    expect(rowsOf(h.db, "app_user").some((u) => u.id === OWNER)).toBe(false);
    expect(rowsOf(h.db, "erasure_receipt")).toHaveLength(2);
  });

  it("stub-behandlere (ikke konfigureret) er et synligt hul, ikke en gennemført sletning — men blokerer ikke Auth", async () => {
    const h = harness(tables({ board: [{ id: IDS.board, name: "B", owner_id: OWNER, calcom_event_type_id: null }] }));
    h.posthog.failWith = new NotConfiguredError("posthog", "eraseDataSubject");
    h.resend.failWith = new NotConfiguredError("resend", "eraseDataSubject");
    const result = await executeErasure(h.deps, { adminId: ADMIN_ID, userId: OWNER, confirmEmail: OWNER_EMAIL });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.systems.filter((s) => s.status === "ikke_konfigureret").map((s) => s.system)).toEqual(["posthog", "resend"]);
    expect(result.receipt.missing).toEqual(["posthog", "resend"]);
    expect(result.receipt.outcome).toBe("gennemfoert");
    expect(h.deleteUser).toHaveBeenCalledTimes(1);
  });

  it("Auth-sletningen fejler: kontoankeret består, udfaldet er 'delvist'", async () => {
    const h = harness(tables({ board: [{ id: IDS.board, name: "B", owner_id: OWNER, calcom_event_type_id: null }] }));
    h.deleteUser.mockResolvedValueOnce({ error: { message: "intern fejl", status: 500 } });
    const result = await executeErasure(h.deps, { adminId: ADMIN_ID, userId: OWNER, confirmEmail: OWNER_EMAIL });
    expect(result.ok && result.receipt.outcome).toBe("delvist");
    expect(rowsOf(h.db, "app_user").some((u) => u.id === OWNER)).toBe(true);
  });

  it("en Auth-bruger der allerede er væk (404) er ikke en fejl", async () => {
    const h = harness(tables({ board: [{ id: IDS.board, name: "B", owner_id: OWNER, calcom_event_type_id: null }] }));
    h.deleteUser.mockResolvedValueOnce({ error: { message: "User not found", status: 404, code: "user_not_found" } });
    const result = await executeErasure(h.deps, { adminId: ADMIN_ID, userId: OWNER, confirmEmail: OWNER_EMAIL });
    expect(result.ok && result.receipt.outcome).toBe("gennemfoert");
    expect(rowsOf(h.db, "app_user").some((u) => u.id === OWNER)).toBe(false); // ankeret fjernes af koden
  });

  it("fejltekster skrubbes: leverandørens svar kan ikke bringe en adresse ind i kvitteringen", async () => {
    const h = harness(tables({ board: [{ id: IDS.board, name: "B", owner_id: OWNER, calcom_event_type_id: null }] }));
    h.resend.failWith = new Error(`Contact ${OWNER_EMAIL} could not be deleted`);
    const result = await executeErasure(h.deps, { adminId: ADMIN_ID, userId: OWNER, confirmEmail: OWNER_EMAIL });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(receiptRow(h))).not.toContain(OWNER_EMAIL);
  });

  it("kvitteringen kan ikke gemmes: sletningen er sket, og det siges højt", async () => {
    const h = harness(tables({ board: [{ id: IDS.board, name: "B", owner_id: OWNER, calcom_event_type_id: null }] }));
    h.db.failures["erasure_receipt.insert"] = "skrivefejl";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await executeErasure(h.deps, { adminId: ADMIN_ID, userId: OWNER, confirmEmail: OWNER_EMAIL });
    expect(result.ok && result.receipt).toMatchObject({ id: null, receiptSaved: false, outcome: "gennemfoert" });
  });
});

describe("en partner: Cal.com-hosts opdateres efter fjernelsen, og fejl der ruller ikke tilbage", () => {
  it("fjerner partneren, opdaterer boardets hosts og retter revisionsrækkens Cal.com-udfald", async () => {
    const h = harness();
    const result = await requestErasure({ user: admin, userId: PARTNER_USER, confirmEmail: PARTNER_EMAIL, makeDeps: h.makeDeps });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const args = h.rpc.mock.calls[0]?.[1] as { p_board_removals: unknown[] };
    expect(args.p_board_removals).toEqual([
      {
        board_id: IDS.board,
        expected_partner_ids: [IDS.anna, IDS.bo, IDS.carl],
        partner_id: IDS.carl,
        lead_id: IDS.anna,
      },
    ]);
    // Hosts er nu Anna og Bo (Carl er væk) — og rækken står som 'opdateret', ikke den pessimistiske 'fejlet'.
    expect(h.booking.upserts.at(-1)?.hostUserIds.sort()).toEqual([11, 12]);
    expect(rowsOf(h.db, "board_change")[0]).toMatchObject({ calcom_sync: "opdateret" });
    const calcom = result.receipt.systems.find((s) => s.system === "calcom");
    expect(calcom?.detail).toMatch(/Hosts opdateret på de 1 berørte boards/);
    // Carls Cal.com-sæde frigives manuelt → et hul på kvitteringen.
    expect(calcom?.status).toBe("manuel");
    expect(result.receipt.missing).toContain("calcom");
  });

  it("Cal.com fejler: Supabase-sletningen står, rækken står som 'fejlet' (hosts hænger efter) og kontoen slettes alligevel", async () => {
    const h = harness();
    h.booking.failWith = new Error("Cal.com nede");
    const result = await executeErasure(h.deps, { adminId: ADMIN_ID, userId: PARTNER_USER, confirmEmail: PARTNER_EMAIL });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(rowsOf(h.db, "board_change")[0]).toMatchObject({ calcom_sync: "fejlet" });
    expect(result.receipt.systems.find((s) => s.system === "calcom")).toMatchObject({ status: "fejlet" });
    // Cal.com kan ikke genkøres (møderne er væk fra Supabase), så den holder ikke kontoen tilbage.
    expect(result.receipt.outcome).toBe("gennemfoert");
    expect(h.deleteUser).toHaveBeenCalledTimes(1);
  });
});

describe("planlægningen læser kun personens egne nøgler", () => {
  it("ingen forespørgsel filtrerer bredt: hver har eq/in på bruger-id, profil-id, board- eller møde-id", async () => {
    const h = harness();
    const { fetch, queries } = fetcherOver(h.db);
    await readErasureFacts(fetch, PARTNER_USER, ADMIN_ID, new Date());
    expect(queries.length).toBeGreaterThan(10);
    for (const query of queries) {
      expect(query.eq || query.in, query.table).toBeTruthy();
    }
    // Den eneste forespørgsel på e-mail-lignende kolonner er ingen: planen slår op på id.
    expect(queries.some((q) => q.eq?.column === "email")).toBe(false);
  });
});
