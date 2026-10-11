import { describe, expect, it } from "vitest";

import { hostsOutOfSync } from "@/server/boards/audit";
import { assertBoardShape, nextPartnerIds, planBoardChange, type MemberRow } from "@/server/boards/composition";
import { listSwapOptions } from "@/server/boards/swap-options";
import type { MatchCandidate } from "@/server/matching/algorithm";

/**
 * Boardets invarianter og lead-regler som rene funktioner (ADR 0062) — de samme som ejerens og
 * admins vej deler. Id'er er syntetiske.
 */
const rows = (...entries: Array<[string, boolean]>): MemberRow[] =>
  entries.map(([partner_id, is_lead]) => ({ partner_id, is_lead }));
const internal = (...ids: string[]) => new Map(ids.map((id) => [id, true]));
const flags = (entries: Record<string, boolean>) => new Map(Object.entries(entries));

describe("nextPartnerIds", () => {
  const current = rows(["a", true], ["b", false]);

  it("tilføj, fjern og udskift giver medlemmerne bagefter i samme rækkefølge", () => {
    expect(nextPartnerIds(current, { kind: "tilfoej", partnerId: "c" })).toEqual(["a", "b", "c"]);
    expect(nextPartnerIds(current, { kind: "fjern", partnerId: "a" })).toEqual(["b"]);
    expect(nextPartnerIds(current, { kind: "udskift", outgoingId: "a", incomingId: "c" })).toEqual(["c", "b"]);
    expect(nextPartnerIds(current, { kind: "saet_lead", partnerId: "b" })).toEqual(["a", "b"]);
  });

  it("afviser dubletter og partnere der ikke sidder på boardet", () => {
    expect(() => nextPartnerIds(current, { kind: "tilfoej", partnerId: "a" })).toThrow(/allerede/);
    expect(() => nextPartnerIds(current, { kind: "fjern", partnerId: "z" })).toThrow(/ikke på boardet/);
    expect(() => nextPartnerIds(current, { kind: "udskift", outgoingId: "z", incomingId: "c" })).toThrow(
      /ikke på boardet/,
    );
    expect(() => nextPartnerIds(current, { kind: "udskift", outgoingId: "a", incomingId: "b" })).toThrow(/allerede/);
    expect(() => nextPartnerIds(current, { kind: "saet_lead", partnerId: "z" })).toThrow(/ikke på boardet/);
  });
});

describe("assertBoardShape", () => {
  it("accepterer 2-3 partnere med mindst én intern", () => {
    expect(() => assertBoardShape(["a", "b"], flags({ a: true, b: false }))).not.toThrow();
    expect(() => assertBoardShape(["a", "b", "c"], flags({ a: false, b: false, c: true }))).not.toThrow();
  });

  it("afviser for få, for mange, ingen intern og dubletter", () => {
    expect(() => assertBoardShape(["a"], internal("a"))).toThrow(/2-3 partnere/);
    expect(() => assertBoardShape(["a", "b", "c", "d"], internal("a", "b", "c", "d"))).toThrow(/2-3 partnere/);
    expect(() => assertBoardShape(["a", "b"], flags({ a: false, b: false }))).toThrow(/mindst én intern/);
    expect(() => assertBoardShape(["a", "a"], internal("a"))).toThrow(/to gange/);
  });
});

describe("planBoardChange — lead", () => {
  const ids = internal("a", "b", "c", "d");

  it("tilføj: lead består, kun den nye indsættes, og værterne påvirkes", () => {
    const plan = planBoardChange(rows(["a", true], ["b", false]), { kind: "tilfoej", partnerId: "c" }, ids);
    expect(plan).toEqual({ nextIds: ["a", "b", "c"], add: ["c"], remove: [], leadId: "a", hostsAffected: true });
  });

  it("fjern lead: den første interne efter fjernelsen overtager", () => {
    const plan = planBoardChange(rows(["a", true], ["b", false], ["c", false]), { kind: "fjern", partnerId: "a" }, ids);
    expect(plan.leadId).toBe("b");
    expect(plan.remove).toEqual(["a"]);
  });

  it("fjern lead når næste i rækken er ekstern: lead går til den første interne", () => {
    const plan = planBoardChange(
      rows(["a", true], ["x", false], ["c", false]),
      { kind: "fjern", partnerId: "a" },
      flags({ a: true, x: false, c: true }),
    );
    expect(plan.leadId).toBe("c");
  });

  it("udskift lead: den indkommende overtager hvis intern, ellers den første interne", () => {
    const current = rows(["a", true], ["b", false]);
    expect(planBoardChange(current, { kind: "udskift", outgoingId: "a", incomingId: "c" }, ids).leadId).toBe("c");
    expect(
      planBoardChange(
        current,
        { kind: "udskift", outgoingId: "a", incomingId: "x" },
        flags({ b: true, x: false }),
      ).leadId,
    ).toBe("b");
  });

  it("udskift en ikke-lead rører ikke lead", () => {
    expect(
      planBoardChange(rows(["a", true], ["b", false]), { kind: "udskift", outgoingId: "b", incomingId: "c" }, ids)
        .leadId,
    ).toBe("a");
  });

  it("en lead der ikke er intern (ældre data) erstattes ved næste ændring", () => {
    const plan = planBoardChange(
      rows(["x", true], ["b", false]),
      { kind: "tilfoej", partnerId: "c" },
      flags({ x: false, b: true, c: true }),
    );
    expect(plan.leadId).toBe("b");
  });

  it("sæt lead: kun interne, ingen ændring i medlemmerne, værterne påvirkes ikke", () => {
    const plan = planBoardChange(rows(["a", true], ["b", false]), { kind: "saet_lead", partnerId: "b" }, ids);
    expect(plan).toEqual({ nextIds: ["a", "b"], add: [], remove: [], leadId: "b", hostsAffected: false });
    expect(() =>
      planBoardChange(rows(["a", true], ["x", false]), { kind: "saet_lead", partnerId: "x" }, flags({ a: true, x: false })),
    ).toThrow(/intern partner/);
  });

  it("afviser en ændring der bryder formen — før noget er skrevet", () => {
    expect(() => planBoardChange(rows(["a", true], ["b", false]), { kind: "fjern", partnerId: "b" }, ids)).toThrow(
      /2-3 partnere/,
    );
  });
});

describe("hostsOutOfSync", () => {
  it("er sand når den seneste Cal.com-handling fejlede — overspringninger tæller ikke", () => {
    expect(hostsOutOfSync([{ calcomSync: "fejlet" }, { calcomSync: "opdateret" }])).toBe(true);
    expect(hostsOutOfSync([{ calcomSync: "sprunget_over" }, { calcomSync: "fejlet" }])).toBe(true);
  });

  it("er falsk når den seneste lykkedes, eller der intet er", () => {
    expect(hostsOutOfSync([{ calcomSync: "opdateret" }, { calcomSync: "fejlet" }])).toBe(false);
    expect(hostsOutOfSync([{ calcomSync: "sprunget_over" }])).toBe(false);
    expect(hostsOutOfSync([])).toBe(false);
  });
});

describe("listSwapOptions", () => {
  const cand = (id: string, isInternal: boolean, tags: string[]): MatchCandidate => ({
    id,
    name: id,
    isInternal,
    sortOrder: 0,
    competenceTagIds: tags,
  });
  const members = [cand("a", true, ["t1"]), cand("b", false, ["t2"])];
  const pool = [...members, cand("c", true, ["t3"]), cand("d", false, ["t1", "t2"])];

  it("lister kun kandidater uden for boardet, med delta mod ejerens behov", () => {
    const options = listSwapOptions(["t1", "t2", "t3"], members, "b", pool);
    expect(options.map((o) => o.candidate.id)).toEqual(["c", "d"]);
    expect(options[0]?.delta).toEqual({ removedTagIds: ["t2"], addedTagIds: ["t3"] });
    expect(options[1]?.delta).toEqual({ removedTagIds: [], addedTagIds: [] });
  });

  it("markerer kandidater der ville efterlade boardet uden intern", () => {
    const options = listSwapOptions(["t1"], members, "a", pool);
    expect(options.find((o) => o.candidate.id === "d")?.keepsInternal).toBe(false);
    expect(options.find((o) => o.candidate.id === "c")?.keepsInternal).toBe(true);
    // Udskifter vi den eksterne, er den interne stadig på plads.
    expect(listSwapOptions(["t1"], members, "b", pool).every((o) => o.keepsInternal)).toBe(true);
  });
});
