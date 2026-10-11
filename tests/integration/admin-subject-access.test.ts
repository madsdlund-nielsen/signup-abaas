import { describe, expect, it, vi } from "vitest";
import { composeSubjectAccessExport } from "@/server/admin/subject-access";
import {
  SubjectExportTooLargeError,
  collectSubjectData,
  supabaseRowFetcher,
  type RowFetcher,
  type RowQuery,
} from "@/server/admin/subject-collect";
import { requestSubjectAccess } from "@/server/admin/subject-request";
import type { AuthUser } from "@/server/auth";

/**
 * Indsigtsudtræk (fase 5.5, ADR 0053): indsamlingen mod en in-memory-fetcher og anmodningsflowets
 * rækkefølge (bruger → admin → først derefter en klient der bypasser RLS). Ingen netværk.
 */

type Row = Record<string, unknown>;

/** Tabeller som rå rækker; fetcheren filtrerer som PostgREST ville. Husker hvad der blev spurgt. */
function memoryFetcher(tables: Record<string, Row[]>): { fetch: RowFetcher; queries: RowQuery[] } {
  const queries: RowQuery[] = [];
  const fetch: RowFetcher = async (query) => {
    queries.push(query);
    let rows = tables[query.table] ?? [];
    if (query.eq) rows = rows.filter((r) => r[query.eq!.column] === query.eq!.value);
    if (query.in) rows = rows.filter((r) => query.in!.values.includes(r[query.in!.column] as string));
    // Som PostgREST: kun de ønskede kolonner kommer med.
    const columns = query.columns.split(",").map((c) => c.trim());
    return rows.map((r) => Object.fromEntries(columns.filter((c) => c in r).map((c) => [c, r[c]])));
  };
  return { fetch, queries };
}

const tables: Record<string, Row[]> = {
  app_user: [
    {
      id: "u1",
      email: "ejer@example.invalid",
      created_at: "2026-01-01T00:00:00Z",
      display_name: "[DEMO] Eva Ejer",
      phone_e164: "+4500000000",
      time_zone: "Europe/Copenhagen",
    },
    { id: "a1", email: "admin@example.invalid", created_at: "2026-01-01T00:00:00Z" },
    {
      id: "u2",
      email: "fremmed@example.invalid",
      created_at: "2026-01-02T00:00:00Z",
      display_name: "[DEMO] Fremmed",
      phone_e164: "+4511111111",
      time_zone: "UTC",
    },
  ],
  user_role_assignment: [
    { user_id: "u1", role: "ejer" },
    { user_id: "u2", role: "ejer" },
    { user_id: "a1", role: "admin" },
  ],
  board: [
    { id: "b1", owner_id: "u1", name: "Mit board", created_at: "2026-02-01T00:00:00Z" },
    { id: "b2", owner_id: "u2", name: "Andens board", created_at: "2026-02-01T00:00:00Z" },
  ],
  board_partner: [
    { board_id: "b1", partner_id: "p1", is_lead: true },
    { board_id: "b2", partner_id: "p2", is_lead: true },
  ],
  partner_profile: [
    { id: "p1", name: "Partner Et", app_user_id: null },
    { id: "p2", name: "Partner To", app_user_id: null },
  ],
  membership: [
    { id: "ms1", board_id: "b1", frequency_weeks: 4, status: "aktiv", provider: "alunta", provider_customer_ref: null, card_status: "mangler", created_at: "2026-02-02T00:00:00Z" },
    { id: "ms2", board_id: "b2", frequency_weeks: 8, status: "aktiv", provider: "alunta", provider_customer_ref: null, card_status: "mangler", created_at: "2026-02-02T00:00:00Z" },
  ],
  meeting: [
    { id: "m1", board_id: "b1", provider: "calcom", provider_booking_uid: null, starts_at: "2026-03-01T09:00:00Z", duration_minutes: 60, prep_minutes: 15, status: "afholdt", video_join_url: null, created_at: "2026-02-20T00:00:00Z" },
    { id: "m2", board_id: "b2", provider: "calcom", provider_booking_uid: null, starts_at: "2026-03-01T10:00:00Z", duration_minutes: 60, prep_minutes: 15, status: "afholdt", video_join_url: null, created_at: "2026-02-20T00:00:00Z" },
  ],
  meeting_partner: [
    { meeting_id: "m1", partner_profile_id: "p1", registered_status: "afholdt", registered_at: null },
    { meeting_id: "m2", partner_profile_id: "p2", registered_status: "afholdt", registered_at: null },
  ],
  meeting_note: [
    { id: "n1", meeting_id: "m1", partner_profile_id: "p1", body: "Note om mit møde", created_at: "2026-03-02T00:00:00Z" },
    { id: "n2", meeting_id: "m2", partner_profile_id: "p2", body: "Note om andens møde", created_at: "2026-03-02T00:00:00Z" },
  ],
  quiz_answer: [
    { owner_id: "u1", quiz_option_id: "o1", free_text: null, created_at: "2026-01-02T00:00:00Z" },
    { owner_id: "u2", quiz_option_id: "o2", free_text: "Andens fritekst", created_at: "2026-01-02T00:00:00Z" },
  ],
  quiz_option: [
    { id: "o1", quiz_question_id: "q1", label: "Mit svar" },
    { id: "o2", quiz_question_id: "q1", label: "Andens svar" },
  ],
  quiz_question: [{ id: "q1", prompt: "Spørgsmål" }],
  // Revisionssporet: ejeren har selv tilføjet p1 (bc1), admin har sat lead på ejerens board (bc2),
  // og en ANDEN ejer + admin har rørt et fremmed board (bc3, bc4) — de må aldrig komme med.
  board_change: [
    { id: "bc1", board_id: "b1", actor_id: "u1", actor_role: "ejer", action: "tilfoej", partner_id: "p1", replaced_partner_id: null, calcom_sync: "opdateret", created_at: "2026-02-03T00:00:00Z" },
    { id: "bc2", board_id: "b1", actor_id: "a1", actor_role: "admin", action: "saet_lead", partner_id: "p1", replaced_partner_id: null, calcom_sync: "sprunget_over", created_at: "2026-02-04T00:00:00Z" },
    { id: "bc3", board_id: "b2", actor_id: "u2", actor_role: "ejer", action: "tilfoej", partner_id: "p2", replaced_partner_id: null, calcom_sync: "opdateret", created_at: "2026-02-03T00:00:00Z" },
    { id: "bc4", board_id: "b2", actor_id: "a1", actor_role: "admin", action: "fjern", partner_id: "p2", replaced_partner_id: null, calcom_sync: "fejlet", created_at: "2026-02-05T00:00:00Z" },
  ],
  meeting_summary: [
    { id: "s1", meeting_id: "m1", status: "klar", summary: "Resumé af mit møde", action_items: ["Ring"], provider: "demo", model: "m", generated_at: "2026-03-02T00:00:00Z", created_at: "2026-03-02T00:00:00Z" },
    { id: "s2", meeting_id: "m2", status: "klar", summary: "Resumé af andens møde", action_items: [], provider: "demo", model: "m", generated_at: "2026-03-02T00:00:00Z", created_at: "2026-03-02T00:00:00Z" },
  ],
  notification_delivery: [
    { id: "nd1", type_key: "moede-bekraeftet", channel: "email", recipient_user_id: "u1", related_id: "m1", status: "sendt", provider_ref: "DEMO-1", created_at: "2026-02-21T00:00:00Z" },
    { id: "nd2", type_key: "moede-bekraeftet", channel: "email", recipient_user_id: "u2", related_id: "m2", status: "sendt", provider_ref: "DEMO-2", created_at: "2026-02-21T00:00:00Z" },
  ],
  rating_link: [
    { id: "rl1", meeting_id: "m1", rater_user_id: "u1", rater_partner_profile_id: null, expires_at: "2026-03-10T00:00:00Z", used_at: null, created_at: "2026-03-02T00:00:00Z" },
    { id: "rl2", meeting_id: "m2", rater_user_id: "u2", rater_partner_profile_id: null, expires_at: "2026-03-10T00:00:00Z", used_at: null, created_at: "2026-03-02T00:00:00Z" },
    { id: "rl3", meeting_id: "m1", rater_user_id: null, rater_partner_profile_id: "p1", expires_at: "2026-03-10T00:00:00Z", used_at: "2026-03-03T00:00:00Z", created_at: "2026-03-02T00:00:00Z" },
  ],
  payment_charge: [
    { id: "c1", meeting_id: "m1", membership_id: "ms1", amount_minor: 1, currency: "DKK", status: "gennemfoert", failure_reason: null, provider_charge_ref: null, provider_invoice_ref: null, created_at: "2026-03-03T00:00:00Z" },
    { id: "c2", meeting_id: "m2", membership_id: "ms2", amount_minor: 1, currency: "DKK", status: "gennemfoert", failure_reason: null, provider_charge_ref: null, provider_invoice_ref: null, created_at: "2026-03-03T00:00:00Z" },
  ],
};

describe("collectSubjectData — scoping til én person", () => {
  it("returnerer null når ingen konto har e-mailen", async () => {
    const { fetch } = memoryFetcher(tables);
    await expect(collectSubjectData(fetch, "ingen@example.invalid")).resolves.toBeNull();
  });

  it("henter kun den ene persons rækker — aldrig en andens", async () => {
    const { fetch } = memoryFetcher(tables);
    const raw = await collectSubjectData(fetch, "ejer@example.invalid");
    expect(raw?.user.id).toBe("u1");
    expect(raw?.ownedBoards.map((b) => b.id)).toEqual(["b1"]);
    expect(raw?.meetings.map((m) => m.id)).toEqual(["m1"]);
    expect(raw?.memberships.map((m) => m.id)).toEqual(["ms1"]);
    expect(raw?.charges.map((c) => c.id)).toEqual(["c1"]);
    expect(raw?.meetingNotes.map((n) => n.id)).toEqual(["n1"]);
    expect(raw?.quizAnswers).toHaveLength(1);
    expect(JSON.stringify(raw)).not.toMatch(/Anden|fremmed/);
  });

  it("tager revisionssporet med: ændringer ejeren selv har udført OG dem admin har udført på ejerens board — aldrig et fremmed boards (B-65)", async () => {
    const { fetch } = memoryFetcher(tables);
    const raw = await collectSubjectData(fetch, "ejer@example.invalid");
    expect(raw?.boardChanges.map((c) => c.id).sort()).toEqual(["bc1", "bc2"]);
    expect(raw?.partnerNames.map((p) => p.id)).toEqual(["p1"]);
  });

  it("en admin får de ændringer vedkommende har udført (aktør-id) — uden en ejer- eller partnerprofil (B-65)", async () => {
    const { fetch } = memoryFetcher(tables);
    const raw = await collectSubjectData(fetch, "admin@example.invalid");
    expect(raw?.ownedBoards).toEqual([]);
    expect(raw?.boardChanges.map((c) => c.id).sort()).toEqual(["bc2", "bc4"]);
    const doc = composeSubjectAccessExport(raw!, { generatedAt: "2026-10-11T00:00:00Z" }) as Record<string, any>;
    expect(doc.board_aendringer_udfoert.map((c: { handling: string }) => c.handling)).toEqual(["saet_lead", "fjern"]);
    expect(doc.board_aendringer_udfoert.every((c: { udfoert_af_dig: boolean }) => c.udfoert_af_dig)).toBe(true);
  });

  it("henter kun personens egne resuméer, udsendelser og vurderingslinks", async () => {
    const { fetch } = memoryFetcher(tables);
    const raw = await collectSubjectData(fetch, "ejer@example.invalid");
    expect(raw?.meetingSummaries.map((s) => s.id)).toEqual(["s1"]);
    expect(raw?.notificationDeliveries.map((n) => n.id)).toEqual(["nd1"]);
    expect(raw?.ratingLinks.map((l) => l.id)).toEqual(["rl1"]);
    expect(JSON.stringify(raw)).not.toMatch(/andens møde|DEMO-2/);
  });

  it("henter personens egen kontoprofil (navn, telefon, tidszone) — ikke den fremmedes", async () => {
    const { fetch } = memoryFetcher(tables);
    const raw = await collectSubjectData(fetch, "ejer@example.invalid");
    expect(raw?.user).toMatchObject({
      display_name: "[DEMO] Eva Ejer",
      phone_e164: "+4500000000",
      time_zone: "Europe/Copenhagen",
    });
    expect(JSON.stringify(raw)).not.toContain("+4511111111");
  });

  it("slår rådgivernes navne op, men kun for dem der optræder hos personen", async () => {
    const { fetch } = memoryFetcher(tables);
    const raw = await collectSubjectData(fetch, "ejer@example.invalid");
    expect(raw?.partnerNames).toEqual([{ id: "p1", name: "Partner Et" }]);
  });

  it("spørger aldrig en tabel uden et filter på personens nøgler", async () => {
    const { fetch, queries } = memoryFetcher(tables);
    await collectSubjectData(fetch, "ejer@example.invalid");
    expect(queries.length).toBeGreaterThan(10);
    expect(queries.every((q) => q.eq || q.in)).toBe(true);
  });

  it("henter partnerens egne rækker når personen har en profil", async () => {
    const { fetch } = memoryFetcher({
      ...tables,
      app_user: [{ id: "u3", email: "partner@example.invalid", created_at: "2026-01-03T00:00:00Z" }],
      user_role_assignment: [{ user_id: "u3", role: "partner" }],
      partner_profile: [{ id: "p1", name: "Partner Et", app_user_id: "u3" }],
    });
    const raw = await collectSubjectData(fetch, "partner@example.invalid");
    expect(raw?.partnerProfile?.id).toBe("p1");
    expect(raw?.memberBoards.map((b) => b.id)).toEqual(["b1"]);
    expect(raw?.meetingPartners.map((mp) => mp.meeting_id)).toEqual(["m1"]);
    expect(raw?.meetingNotes.map((n) => n.id)).toEqual(["n1"]);
    // Ændringer der handler om partneren (partner_id), og vedkommendes eget vurderingslink:
    expect(raw?.boardChanges.map((c) => c.id).sort()).toEqual(["bc1", "bc2"]);
    expect(raw?.ratingLinks.map((l) => l.id)).toEqual(["rl3"]);
  });
});

describe("supabaseRowFetcher", () => {
  function fakeClient(result: { data: unknown; error: { message: string } | null }) {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.in = () => builder;
    builder.limit = async () => result;
    return { from: () => builder } as never;
  }

  it("springer en tom in-liste over uden at læse (ingen ufiltreret læsning)", async () => {
    const from = vi.fn();
    const fetch = supabaseRowFetcher({ from } as never);
    await expect(fetch({ table: "meeting", columns: "id", in: { column: "board_id", values: [] } })).resolves.toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("fejler højlydt når en tabel rammer rækkegrænsen — ikke et stille afkortet udtræk", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const fetch = supabaseRowFetcher(fakeClient({ data: rows, error: null }));
    await expect(fetch({ table: "payment_charge", columns: "id", eq: { column: "a", value: "b" } })).rejects.toBeInstanceOf(
      SubjectExportTooLargeError,
    );
  });

  it("nævner tabel og databasefejl, aldrig filterværdien", async () => {
    const fetch = supabaseRowFetcher(fakeClient({ data: null, error: { message: "boom" } }));
    const error = await fetch({
      table: "app_user",
      columns: "id",
      eq: { column: "email", value: "hemmelig@example.invalid" },
    }).catch((e: Error) => e);
    expect((error as Error).message).toBe("Læsning af app_user fejlede: boom");
    expect((error as Error).message).not.toContain("hemmelig");
  });
});

describe("requestSubjectAccess — rækkefølgen", () => {
  const admin: AuthUser = { id: "a1", email: "admin@example.invalid", roles: ["admin"] };
  const owner: AuthUser = { id: "u1", email: "ejer@example.invalid", roles: ["ejer"] };

  it("nægter uden bruger — og bygger aldrig service-role-fetcheren", async () => {
    const makeFetcher = vi.fn();
    await expect(
      requestSubjectAccess({ user: null, email: "ejer@example.invalid", makeFetcher }),
    ).resolves.toEqual({ ok: false, code: "ikke-logget-ind" });
    expect(makeFetcher).not.toHaveBeenCalled();
  });

  it("nægter en ikke-admin — selv en ejer der beder om sin EGEN indsigt — uden at røre service-role", async () => {
    const makeFetcher = vi.fn();
    await expect(
      requestSubjectAccess({ user: owner, email: "ejer@example.invalid", makeFetcher }),
    ).resolves.toEqual({ ok: false, code: "ikke-admin" });
    expect(makeFetcher).not.toHaveBeenCalled();
  });

  it("afviser en ugyldig e-mail før databasen røres", async () => {
    const makeFetcher = vi.fn();
    await expect(requestSubjectAccess({ user: admin, email: "nej", makeFetcher })).resolves.toEqual({
      ok: false,
      code: "ugyldig-email",
    });
    expect(makeFetcher).not.toHaveBeenCalled();
  });

  it("melder ikke-fundet for en ukendt adresse", async () => {
    const { fetch } = memoryFetcher(tables);
    await expect(
      requestSubjectAccess({ user: admin, email: "ingen@example.invalid", makeFetcher: () => fetch }),
    ).resolves.toEqual({ ok: false, code: "ikke-fundet" });
  });

  it("leverer et JSON-dokument for en admin, med dato-navngivet fil uden persondata", async () => {
    const { fetch } = memoryFetcher(tables);
    const result = await requestSubjectAccess({
      user: admin,
      email: " Ejer@Example.invalid ",
      makeFetcher: () => fetch,
      now: new Date("2026-10-10T12:00:00Z"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileName).toBe("indsigtsudtraek-2026-10-10.json");
    const doc = JSON.parse(result.body);
    expect(doc.person.email).toBe("ejer@example.invalid");
    expect(doc.ejer.boards[0].navn).toBe("Mit board");
    expect(result.body).not.toContain("Andens");
  });
});
