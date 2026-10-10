import { describe, expect, it } from "vitest";
import {
  countCharges,
  countMeetings,
  countMemberships,
  countMissingRegistrations,
  countPlatform,
} from "@/server/admin/ops-summary";
import { classifyAdapter, countModes, flagEnvName } from "@/server/admin/integrations";

/** Driftsoverblikkets rene optællinger (fase 5.4, ADR 0053) — ingen database. */
describe("countPlatform", () => {
  it("tæller ejere som distinkte ejere, ikke som antal boards", () => {
    const result = countPlatform(
      [{ owner_id: "a" }, { owner_id: "a" }, { owner_id: "b" }],
      [{ app_user_id: "p1" }, { app_user_id: null }, { app_user_id: null }],
    );
    expect(result).toEqual({
      boards: 3,
      ownersWithBoard: 2,
      partners: 3,
      partnersLinked: 1,
      partnersUnlinked: 2,
    });
  });

  it("giver rene nuller på tom tilstand", () => {
    expect(countPlatform([], [])).toEqual({
      boards: 0,
      ownersWithBoard: 0,
      partners: 0,
      partnersLinked: 0,
      partnersUnlinked: 0,
    });
  });
});

describe("countMemberships", () => {
  it("krydser status og kortstatus uden at dobbelttælle", () => {
    const result = countMemberships([
      { status: "aktiv", card_status: "registreret" },
      { status: "aktiv", card_status: "mangler" },
      { status: "opsagt", card_status: "registreret" },
    ]);
    expect(result).toEqual({ total: 3, active: 2, cancelled: 1, cardRegistered: 2, cardMissing: 1 });
  });
});

describe("countCharges", () => {
  const rows = [
    { id: "1", status: "gennemfoert" as const, failure_reason: null, updated_at: "2026-10-01T10:00:00Z" },
    { id: "2", status: "fejlet" as const, failure_reason: "card_declined", updated_at: "2026-10-02T10:00:00Z" },
    { id: "3", status: "afventer" as const, failure_reason: null, updated_at: "2026-10-03T10:00:00Z" },
    { id: "4", status: "fejlet" as const, failure_reason: null, updated_at: "2026-10-04T10:00:00Z" },
  ];

  it("tæller pr. status", () => {
    const result = countCharges(rows);
    expect([result.pending, result.succeeded, result.failed]).toEqual([1, 1, 2]);
  });

  it("lister de seneste fejlede først — med årsag, eller null når ingen er modtaget", () => {
    const { recentFailures } = countCharges(rows);
    expect(recentFailures.map((f) => f.id)).toEqual(["4", "2"]);
    expect(recentFailures[0]?.reason).toBeNull();
    expect(recentFailures[1]?.reason).toBe("card_declined");
  });

  it("afkorter listen til grænsen", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: String(i),
      status: "fejlet" as const,
      failure_reason: null,
      updated_at: `2026-10-0${i + 1}T10:00:00Z`,
    }));
    const result = countCharges(many, 3);
    expect(result.failed).toBe(9);
    expect(result.recentFailures).toHaveLength(3);
  });
});

describe("countMeetings", () => {
  const now = new Date("2026-10-10T12:00:00Z");

  it("skelner kommende, afholdt, aflyst og planlagt-men-passeret", () => {
    const result = countMeetings(
      [
        { status: "planlagt", starts_at: "2026-10-12T09:00:00Z" },
        { status: "planlagt", starts_at: "2026-09-01T09:00:00Z" },
        { status: "afholdt", starts_at: "2026-10-05T09:00:00Z" },
        { status: "aflyst", starts_at: "2026-10-06T09:00:00Z" },
      ],
      now,
    );
    expect(result).toEqual({ windowDays: 30, upcoming: 1, overdue: 1, held: 1, cancelled: 1 });
  });

  it("tæller kun afholdt/aflyst i vinduet", () => {
    const result = countMeetings(
      [
        { status: "afholdt", starts_at: "2026-08-01T09:00:00Z" },
        { status: "aflyst", starts_at: "2026-08-02T09:00:00Z" },
        { status: "afholdt", starts_at: "2026-09-11T09:00:00Z" },
      ],
      now,
    );
    expect(result.held).toBe(1);
    expect(result.cancelled).toBe(0);
  });

  it("ignorerer en ulæselig tid frem for at tælle den et sted den ikke hører til", () => {
    const result = countMeetings([{ status: "planlagt", starts_at: "ikke-en-dato" }], now);
    expect(result.upcoming + result.overdue).toBe(0);
  });
});

describe("countMissingRegistrations", () => {
  it("tæller møder og rækker hver for sig", () => {
    expect(
      countMissingRegistrations([{ meeting_id: "m1" }, { meeting_id: "m1" }, { meeting_id: "m2" }]),
    ).toEqual({ meetings: 2, registrations: 3 });
  });
});

describe("integrationsstatus — rene hjælpere", () => {
  it("klassificerer adapternavne: stub, demo — alt andet er rigtigt", () => {
    expect(classifyAdapter("stub")).toBe("stub");
    expect(classifyAdapter("demo")).toBe("demo");
    expect(classifyAdapter("calcom")).toBe("real");
    expect(classifyAdapter("alunta")).toBe("real");
  });

  it("udleder env-navnet flaget læses fra", () => {
    expect(flagEnvName("aiFollowup")).toBe("FLAG_AIFOLLOWUP");
    expect(flagEnvName("booking")).toBe("FLAG_BOOKING");
  });

  it("tæller tilstande", () => {
    expect(countModes([{ mode: "stub" }, { mode: "stub" }, { mode: "real" }])).toEqual({
      real: 1,
      demo: 0,
      stub: 2,
    });
  });
});
