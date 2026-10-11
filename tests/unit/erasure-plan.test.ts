import { describe, expect, it } from "vitest";

import { computeErasurePlan, type ErasureFacts } from "@/server/erasure/plan";
import { subjectHash, worstStatus } from "@/server/erasure/execute";

/**
 * Sletteplanen (ADR 0068) — den rene beregning over læste fakta. Intet netværk, ingen database.
 * Kernen: opbevaringspligt er FAIL-CLOSED (🔴 ejer/jura), boardets invarianter afgør om en partner
 * kan fjernes (B-68), og planen siger hvad der slettes, hvad der blokerer og hvad eksterne skal have besked.
 */

const NOW = new Date("2026-10-11T12:00:00Z");

function facts(overrides: Partial<ErasureFacts> = {}): ErasureFacts {
  return {
    user: { id: "u1", displayName: "[DEMO] Eva", hasPhone: false },
    actorId: "admin-1",
    roles: ["ejer"],
    otherAdminCount: 1,
    ownedBoards: [],
    memberships: 0,
    charges: 0,
    ownedMeetings: [],
    ownedRegisteredPartners: 0,
    ownedNotes: 0,
    ownedAgendaItems: 0,
    ownedPrepNotes: 0,
    ownedSummaries: 0,
    ownedMeetingRatings: 0,
    quizAnswers: 0,
    ratingsGiven: 0,
    ratingLinks: 0,
    deliveries: 0,
    boardChangesAsActor: 0,
    profile: null,
    now: NOW,
    ...overrides,
  };
}

type Profile = NonNullable<ErasureFacts["profile"]>;

function partnerFacts(boards: Profile["boards"], members: Profile["members"]): ErasureFacts {
  return facts({
    user: { id: "u2", displayName: "[DEMO] Partner", hasPhone: false },
    roles: ["partner"],
    profile: {
      id: "pp",
      calcomUserId: null,
      boards,
      members,
      internalById: { pp: false, a: true, b: true, c: false },
      meetings: 2,
      registeredMeetings: 0,
      notes: 1,
      prepNotes: 1,
      availability: 3,
      absences: 1,
      ratingsGiven: 2,
      ratingsAbout: 4,
      ratingLinks: 1,
      tags: 2,
    },
  });
}

describe("computeErasurePlan — en almindelig ejer", () => {
  it("er udførbar, tæller hvad der slettes og kender ikke e-mail eller telefon", () => {
    const plan = computeErasurePlan(
      facts({
        ownedBoards: [{ id: "b1", name: "[DEMO] Board" }],
        ownedMeetings: [{ id: "m1", status: "afholdt", startsAt: "2026-01-01T10:00:00Z", bookingUid: null }],
        quizAnswers: 3,
        deliveries: 5,
        boardChangesAsActor: 2,
      }),
    );
    expect(plan.executable).toBe(true);
    expect(plan.blockers).toEqual([]);
    const count = (label: RegExp) => plan.deletions.find((d) => label.test(d.label))?.count;
    expect(count(/Kvizsvar/)).toBe(3);
    expect(count(/Udsendelseslog/)).toBe(5);
    expect(count(/Boards personen ejer/)).toBe(1);
    expect(plan.deletions.find((d) => d.kind === "anonymiseres")).toMatchObject({ count: 2 });
    expect(JSON.stringify(plan)).not.toMatch(/@|\+45/);
  });

  it("PostHog og Resend er altid med; Cal.com, inMobile og Ordbogen kun når personen har noget dér", () => {
    const bare = computeErasurePlan(facts());
    expect(bare.externals.map((e) => e.processor)).toEqual(["posthog", "resend"]);

    const full = computeErasurePlan(
      facts({
        user: { id: "u1", displayName: null, hasPhone: true },
        ownedBoards: [{ id: "b1", name: "B" }],
        ownedMeetings: [{ id: "m1", status: "afholdt", startsAt: "2026-01-01T10:00:00Z", bookingUid: "uid-1" }],
        ownedSummaries: 1,
      }),
    );
    expect(full.externals.map((e) => e.processor)).toEqual(["posthog", "resend", "calcom", "inmobile", "ordbogen"]);
    // Uden automatisk sletning står de som manuelle huller, ikke som noget der "bare sker".
    expect(full.externals.find((e) => e.processor === "inmobile")).toMatchObject({ automatic: null, manualIsGap: true });
    expect(full.externals.find((e) => e.processor === "ordbogen")).toMatchObject({ automatic: null, manualIsGap: true });
    // Resends maillog er en note, ikke et hul.
    expect(full.externals.find((e) => e.processor === "resend")).toMatchObject({ manualIsGap: false });
  });

  it("kun kommende, planlagte møder med en booking aflyses hos Cal.com", () => {
    const plan = computeErasurePlan(
      facts({
        ownedMeetings: [
          { id: "m1", status: "planlagt", startsAt: "2026-12-01T10:00:00Z", bookingUid: "fremtid" },
          { id: "m2", status: "planlagt", startsAt: "2026-01-01T10:00:00Z", bookingUid: "fortid" },
          { id: "m3", status: "aflyst", startsAt: "2026-12-02T10:00:00Z", bookingUid: "aflyst" },
          { id: "m4", status: "planlagt", startsAt: "2026-12-03T10:00:00Z", bookingUid: null },
        ],
      }),
    );
    expect(plan.upcomingBookingUids).toEqual(["fremtid"]);
    expect(plan.hasBookings).toBe(true);
  });
});

describe("computeErasurePlan — opbevaringspligt er fail-closed (🔴 ejer/jura)", () => {
  it("NEGATIV: et medlemskab blokerer og siger hvorfor, med TODO(ejer/jura)", () => {
    const plan = computeErasurePlan(facts({ ownedBoards: [{ id: "b1", name: "B" }], memberships: 1 }));
    expect(plan.executable).toBe(false);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0]?.code).toBe("opbevaringspligt-betaling");
    expect(plan.blockers[0]?.message).toMatch(/Afventer afklaring af opbevaringspligt \(TODO\(ejer\/jura\)\)/);
  });

  it("NEGATIV: betalingstræk alene blokerer også", () => {
    const plan = computeErasurePlan(facts({ charges: 2 }));
    expect(plan.blockers.map((b) => b.code)).toEqual(["opbevaringspligt-betaling"]);
  });

  it("NEGATIV: et registreret honorargrundlag blokerer — på ejerens møder og på partnerens egne", () => {
    const owner = computeErasurePlan(facts({ ownedRegisteredPartners: 1 }));
    expect(owner.blockers.map((b) => b.code)).toEqual(["opbevaringspligt-honorar"]);

    const base = partnerFacts([{ id: "b1", name: "B", ownedBySubject: false }], [
      { board_id: "b1", partner_id: "a", is_lead: true },
      { board_id: "b1", partner_id: "b", is_lead: false },
      { board_id: "b1", partner_id: "pp", is_lead: false },
    ]);
    const partner = computeErasurePlan({ ...base, profile: { ...base.profile!, registeredMeetings: 1 } });
    expect(partner.blockers.map((b) => b.code)).toEqual(["opbevaringspligt-honorar"]);
  });
});

describe("computeErasurePlan — driftsværn", () => {
  it("NEGATIV: en admin kan ikke slette sig selv", () => {
    const plan = computeErasurePlan(facts({ actorId: "u1", roles: ["admin"] }));
    expect(plan.blockers.map((b) => b.code)).toContain("selv");
  });

  it("NEGATIV: den sidste admin kan ikke slettes — men en af flere kan", () => {
    expect(computeErasurePlan(facts({ roles: ["admin"], otherAdminCount: 0 })).blockers.map((b) => b.code)).toEqual([
      "sidste-admin",
    ]);
    expect(computeErasurePlan(facts({ roles: ["admin"], otherAdminCount: 1 })).executable).toBe(true);
  });
});

describe("computeErasurePlan — partner og boardets invarianter (B-68)", () => {
  const board = (id = "b1") => ({ id, name: `[DEMO] ${id}`, ownedBySubject: false });

  it("et board med tre partnere: fjernelsen planlægges med boardets nuværende medlemmer som udgangspunkt", () => {
    const plan = computeErasurePlan(
      partnerFacts([board()], [
        { board_id: "b1", partner_id: "a", is_lead: true },
        { board_id: "b1", partner_id: "b", is_lead: false },
        { board_id: "b1", partner_id: "pp", is_lead: false },
      ]),
    );
    expect(plan.executable).toBe(true);
    expect(plan.boardRemovals).toEqual([
      { boardId: "b1", boardName: "[DEMO] b1", expectedPartnerIds: ["a", "b", "pp"], partnerId: "pp", leadId: "a" },
    ]);
  });

  it("er partneren lead, flyttes leadet til den første interne (pladsholder — TODO(ejer): lead-partner regler)", () => {
    const base = partnerFacts([board()], [
      { board_id: "b1", partner_id: "pp", is_lead: true },
      { board_id: "b1", partner_id: "a", is_lead: false },
      { board_id: "b1", partner_id: "c", is_lead: false },
    ]);
    base.profile = { ...base.profile!, internalById: { pp: true, a: true, c: false } };
    const plan = computeErasurePlan(base);
    expect(plan.executable).toBe(true);
    expect(plan.boardRemovals[0]).toMatchObject({ partnerId: "pp", leadId: "a" });
  });

  it("NEGATIV: et board med to partnere ville ende under to → blokeret med boardets navn (B-68)", () => {
    const plan = computeErasurePlan(
      partnerFacts([board()], [
        { board_id: "b1", partner_id: "a", is_lead: true },
        { board_id: "b1", partner_id: "pp", is_lead: false },
      ]),
    );
    expect(plan.executable).toBe(false);
    const blocker = plan.blockers.find((b) => b.code === "board-invariant");
    expect(blocker?.boards).toEqual([{ id: "b1", name: "[DEMO] b1", reason: "Et board skal bestå af 2-3 partnere." }]);
    expect(blocker?.message).toMatch(/Udskift partneren på boardet først/);
    expect(plan.boardRemovals).toEqual([]);
  });

  it("NEGATIV: den sidste interne kan ikke fjernes", () => {
    const base = partnerFacts([board()], [
      { board_id: "b1", partner_id: "pp", is_lead: true },
      { board_id: "b1", partner_id: "c", is_lead: false },
      { board_id: "b1", partner_id: "x", is_lead: false },
    ]);
    base.profile = { ...base.profile!, internalById: { pp: true, c: false, x: false } };
    const plan = computeErasurePlan(base);
    expect(plan.blockers.find((b) => b.code === "board-invariant")?.boards?.[0]?.reason).toMatch(/mindst én intern/);
  });

  it("alle blokerede boards listes, ikke kun det første; de gyldige planlægges stadig", () => {
    const plan = computeErasurePlan(
      partnerFacts([board("b1"), board("b2"), board("b3")], [
        { board_id: "b1", partner_id: "a", is_lead: true },
        { board_id: "b1", partner_id: "pp", is_lead: false },
        { board_id: "b2", partner_id: "a", is_lead: true },
        { board_id: "b2", partner_id: "b", is_lead: false },
        { board_id: "b2", partner_id: "pp", is_lead: false },
        { board_id: "b3", partner_id: "b", is_lead: true },
        { board_id: "b3", partner_id: "pp", is_lead: false },
      ]),
    );
    expect(plan.blockers.find((b) => b.code === "board-invariant")?.boards?.map((b) => b.id)).toEqual(["b1", "b3"]);
    expect(plan.boardRemovals.map((r) => r.boardId)).toEqual(["b2"]);
  });

  it("et board personen selv ejer slettes helt og kræver ingen sammensætning", () => {
    const plan = computeErasurePlan(
      partnerFacts([{ id: "b1", name: "Eget", ownedBySubject: true }], [
        { board_id: "b1", partner_id: "a", is_lead: true },
        { board_id: "b1", partner_id: "pp", is_lead: false },
      ]),
    );
    expect(plan.executable).toBe(true);
    expect(plan.boardRemovals).toEqual([]);
  });

  it("sætter partnerens ting på listen over det der slettes, inkl. fravær og modtagne vurderinger", () => {
    const plan = computeErasurePlan(
      partnerFacts([board()], [
        { board_id: "b1", partner_id: "a", is_lead: true },
        { board_id: "b1", partner_id: "b", is_lead: false },
        { board_id: "b1", partner_id: "pp", is_lead: false },
      ]),
    );
    const find = (re: RegExp) => plan.deletions.find((d) => re.test(d.label));
    expect(find(/Partnerprofil/)).toMatchObject({ count: 1, kind: "slettes" });
    expect(find(/Tilgængelighed og fravær/)).toMatchObject({ count: 4 });
    expect(find(/Modtagne vurderinger/)).toMatchObject({ count: 4 });
    expect(find(/Vurderinger afgivet som partner/)).toMatchObject({ count: 2 });
    expect(plan.hasPartnerProfile).toBe(true);
  });

  it("partnerens Cal.com-sæde står som et manuelt hul", () => {
    const base = partnerFacts([board()], [
      { board_id: "b1", partner_id: "a", is_lead: true },
      { board_id: "b1", partner_id: "b", is_lead: false },
      { board_id: "b1", partner_id: "pp", is_lead: false },
    ]);
    base.profile = { ...base.profile!, calcomUserId: 77 };
    const calcom = computeErasurePlan(base).externals.find((e) => e.processor === "calcom");
    expect(calcom?.automatic).toMatch(/vært/);
    expect(calcom?.manual).toMatch(/sæde/);
    expect(calcom?.manualIsGap).toBe(true);
  });
});

describe("kvitteringens hjælpere", () => {
  it("id-hash'et er SHA-256 (hex), deterministisk og indeholder ikke id'et", () => {
    const hash = subjectHash("11111111-1111-1111-1111-111111111111");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(subjectHash("11111111-1111-1111-1111-111111111111")).toBe(hash);
    expect(hash).not.toContain("1111-1111");
    expect(subjectHash("22222222-2222-2222-2222-222222222222")).not.toBe(hash);
  });

  it("det værste udfald vinder", () => {
    expect(worstStatus(["slettet", "intet_at_slette"])).toBe("slettet");
    expect(worstStatus(["slettet", "manuel"])).toBe("manuel");
    expect(worstStatus(["manuel", "ikke_konfigureret", "slettet"])).toBe("ikke_konfigureret");
    expect(worstStatus(["slettet", "fejlet", "manuel"])).toBe("fejlet");
    expect(worstStatus([])).toBe("intet_at_slette");
  });
});
