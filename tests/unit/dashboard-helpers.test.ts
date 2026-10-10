import { describe, expect, it } from "vitest";

import { computeBoardCoverage, isLeadOnBoard } from "@/server/dashboard/coverage";
import {
  formatMeetingStart,
  formatMeetingStartShort,
  participantNames,
  upcomingMeetings,
} from "@/server/dashboard/meetings";

/**
 * Rene hjælpere bag rolle-dashboardene (fase 5.4, ADR 0055): hvad er et kommende møde, hvordan
 * vises det på dansk, og hvad dækker boardet af ejerens behov.
 */
const NOW = new Date("2026-10-10T12:00:00Z");

function meeting(id: string, startsAt: string, overrides: Partial<Parameters<typeof upcomingMeetings>[0][number]> = {}) {
  return { id, boardId: "b1", startsAt, status: "planlagt" as const, ...overrides };
}

describe("upcomingMeetings", () => {
  it("beholder kun planlagte møder der ikke ligger før nu, tidligst først", () => {
    const result = upcomingMeetings(
      [
        meeting("senere", "2026-12-01T10:00:00Z"),
        meeting("fortid", "2026-10-01T10:00:00Z"),
        meeting("snart", "2026-10-12T10:00:00Z"),
      ],
      NOW,
    );
    expect(result.map((m) => m.id)).toEqual(["snart", "senere"]);
  });

  it("udelader aflyste og afholdte, også når de ligger i fremtiden", () => {
    const result = upcomingMeetings(
      [
        meeting("aflyst", "2026-11-01T10:00:00Z", { status: "aflyst" }),
        meeting("afholdt", "2026-11-02T10:00:00Z", { status: "afholdt" }),
        meeting("planlagt", "2026-11-03T10:00:00Z"),
      ],
      NOW,
    );
    expect(result.map((m) => m.id)).toEqual(["planlagt"]);
  });

  it("et møde der starter præcis nu er stadig kommende", () => {
    expect(upcomingMeetings([meeting("nu", NOW.toISOString())], NOW)).toHaveLength(1);
  });

  it("afgrænser til ét board — en admin ser via RLS alle møder og må ikke se andres som sine", () => {
    const result = upcomingMeetings(
      [
        meeting("mit", "2026-11-01T10:00:00Z"),
        meeting("andres", "2026-11-02T10:00:00Z", { boardId: "b2" }),
      ],
      NOW,
      "b1",
    );
    expect(result.map((m) => m.id)).toEqual(["mit"]);
  });

  it("udelader uparsbare tidspunkter frem for at lade dem lande først", () => {
    expect(upcomingMeetings([meeting("skidt", "ikke-en-dato")], NOW)).toEqual([]);
  });

  it("muterer ikke input og klarer en tom liste", () => {
    const input = [meeting("b", "2026-11-02T10:00:00Z"), meeting("a", "2026-11-01T10:00:00Z")];
    upcomingMeetings(input, NOW);
    expect(input.map((m) => m.id)).toEqual(["b", "a"]);
    expect(upcomingMeetings([], NOW)).toEqual([]);
  });
});

describe("formatMeetingStart", () => {
  it("skriver dato og klokkeslæt på dansk i dansk tid (sommertid: UTC+2)", () => {
    const text = formatMeetingStart("2026-10-12T08:00:00Z");
    expect(text).toMatch(/mandag/i);
    expect(text).toMatch(/12\. oktober/);
    // 08:00 UTC = 10:00 dansk sommertid; ICU skriver enten "10.00" eller "10:00".
    expect(text).toMatch(/10[.:]00/);
  });

  it("følger vintertid (UTC+1) og ikke serverens tidszone", () => {
    expect(formatMeetingStart("2026-12-14T09:00:00Z")).toMatch(/10[.:]00/);
  });

  it("giver '—' for et ugyldigt tidspunkt", () => {
    expect(formatMeetingStart("pjat")).toBe("—");
    expect(formatMeetingStartShort("pjat")).toBe("—");
  });

  it("den korte form har dato og tid", () => {
    expect(formatMeetingStartShort("2026-10-12T08:00:00Z")).toMatch(/12\. okt\.? 2026/);
  });
});

describe("participantNames", () => {
  it("lister navnene og er ærlig når ingen er tilmeldt", () => {
    const p = (name: string) => ({ partnerProfileId: name, name, registeredStatus: null });
    expect(participantNames({ participants: [p("Åse"), p("Bo")] })).toBe("Åse, Bo");
    expect(participantNames({ participants: [] })).toBe("Ingen deltagere endnu");
  });
});

describe("computeBoardCoverage", () => {
  const members = [
    { partnerId: "p1", name: "Åse", competenceTagIds: ["salg", "ledelse"] },
    { partnerId: "p2", name: "Bo", competenceTagIds: ["oekonomi", "salg"] },
  ];

  it("viser pr. behov hvem der dækker det, og hvad der er udækket", () => {
    const coverage = computeBoardCoverage(["salg", "oekonomi", "jura"], members);
    expect(coverage.coveredTagIds).toEqual(["salg", "oekonomi"]);
    expect(coverage.uncoveredTagIds).toEqual(["jura"]);
    expect(coverage.needs.find((n) => n.tagId === "salg")?.coveredBy.map((c) => c.name)).toEqual([
      "Åse",
      "Bo",
    ]);
    expect(coverage.needs.find((n) => n.tagId === "jura")?.coveredBy).toEqual([]);
  });

  it("bevarer ejerens rækkefølge og tæller et duplikeret behov én gang", () => {
    const coverage = computeBoardCoverage(["ledelse", "salg", "ledelse"], members);
    expect(coverage.needs.map((n) => n.tagId)).toEqual(["ledelse", "salg"]);
  });

  it("tags ud over ejerens behov tæller ikke som dækning", () => {
    const coverage = computeBoardCoverage(["jura"], members);
    expect(coverage.coveredTagIds).toEqual([]);
    expect(coverage.uncoveredTagIds).toEqual(["jura"]);
  });

  it("uden behov er der intet at dække — og uden medlemmer er alt udækket", () => {
    expect(computeBoardCoverage([], members)).toEqual({
      needs: [],
      coveredTagIds: [],
      uncoveredTagIds: [],
    });
    expect(computeBoardCoverage(["salg"], []).uncoveredTagIds).toEqual(["salg"]);
  });
});

describe("isLeadOnBoard", () => {
  const board = {
    members: [
      { partnerId: "p1", isLead: true },
      { partnerId: "p2", isLead: false },
    ],
  };

  it("sand kun for det medlem der er markeret som lead", () => {
    expect(isLeadOnBoard("p1", board)).toBe(true);
    expect(isLeadOnBoard("p2", board)).toBe(false);
  });

  it("falsk uden profil, uden board eller for en der ikke sidder på boardet", () => {
    expect(isLeadOnBoard(null, board)).toBe(false);
    expect(isLeadOnBoard(undefined, board)).toBe(false);
    expect(isLeadOnBoard("p1", null)).toBe(false);
    expect(isLeadOnBoard("p9", board)).toBe(false);
  });
});
