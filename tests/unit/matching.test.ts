import { describe, expect, it } from "vitest";
import {
  computeSwapDelta,
  matchBoard,
  MAX_BOARD_SIZE,
  MIN_BOARD_SIZE,
  type MatchCandidate,
} from "@/server/matching/algorithm";

/**
 * Board-matching (fase 1.5, ADR 0022). Algoritmen er bevidst DB-fri, så den kan testes uden Postgres.
 * Krav der verificeres: 2-3 partnere (byggespec §0/§5.2), mindst 1 intern (§3/§5.6), og en
 * deterministisk tie-break så et match aldrig skifter mellem to kørsler.
 */

function candidate(
  id: string,
  sortOrder: number,
  isInternal: boolean,
  competenceTagIds: string[],
  name = `Partner ${id}`,
): MatchCandidate {
  return { id, name, isInternal, sortOrder, competenceTagIds };
}

describe("matchBoard — dækning", () => {
  it("dækker alle ønskede tags med færrest mulige partnere", () => {
    const result = matchBoard(
      ["t1", "t2", "t3"],
      [
        candidate("i1", 1, true, ["t1"]),
        candidate("e1", 2, false, ["t2", "t3"]),
        candidate("e2", 3, false, ["t3"]),
      ],
    );

    expect(result.partnerIds).toEqual(["i1", "e1"]);
    expect(result.coveredTagIds).toEqual(["t1", "t2", "t3"]);
    expect(result.uncoveredTagIds).toEqual([]);
  });

  it("rapporterer kompetencegab når puljen ikke kan dække alt", () => {
    const result = matchBoard(
      ["t1", "t2", "t3", "t4"],
      [
        candidate("i1", 1, true, ["t1"]),
        candidate("e1", 2, false, ["t2"]),
        candidate("e2", 3, false, ["t3"]),
        candidate("e3", 4, false, ["t4"]),
      ],
    );

    expect(result.partnerIds).toHaveLength(MAX_BOARD_SIZE);
    expect(result.uncoveredTagIds).toEqual(["t4"]);
  });

  it("overstiger aldrig 3 partnere", () => {
    const result = matchBoard(
      ["t1", "t2", "t3", "t4", "t5"],
      Array.from({ length: 8 }, (_, index) =>
        candidate(`p${index}`, index, index === 0, [`t${index}`]),
      ),
    );

    expect(result.partnerIds.length).toBeLessThanOrEqual(MAX_BOARD_SIZE);
  });

  it("topper op til 2 partnere selv når én dækker alt", () => {
    const result = matchBoard(
      ["t1"],
      [candidate("i1", 1, true, ["t1"]), candidate("e1", 2, false, [])],
    );

    expect(result.partnerIds).toHaveLength(MIN_BOARD_SIZE);
    expect(result.partnerIds[0]).toBe("i1");
  });

  it("giver et board selv uden quiz-svar (ingen ønskede tags)", () => {
    const result = matchBoard(
      [],
      [candidate("i1", 1, true, ["t1"]), candidate("e1", 2, false, ["t2"])],
    );

    expect(result.partnerIds).toHaveLength(MIN_BOARD_SIZE);
    expect(result.coveredTagIds).toEqual([]);
    expect(result.uncoveredTagIds).toEqual([]);
  });
});

describe("matchBoard — mindst 1 intern partner", () => {
  it("vælger altid en intern partner først, selv når en ekstern dækker mere", () => {
    const result = matchBoard(
      ["t1", "t2"],
      [candidate("e1", 1, false, ["t1", "t2"]), candidate("i1", 2, true, ["t1"])],
    );

    expect(result.partnerIds[0]).toBe("i1");
    expect(result.hasInternalPartner).toBe(true);
  });

  it("NEGATIV: markerer boardet som ugyldigt når puljen slet ingen interne har", () => {
    const result = matchBoard(
      ["t1"],
      [candidate("e1", 1, false, ["t1"]), candidate("e2", 2, false, ["t1"])],
    );

    expect(result.hasInternalPartner).toBe(false);
  });

  it("vælger den bedst dækkende interne, ikke bare den første", () => {
    const result = matchBoard(
      ["t1", "t2"],
      [candidate("i1", 1, true, ["t1"]), candidate("i2", 2, true, ["t1", "t2"])],
    );

    expect(result.partnerIds[0]).toBe("i2");
  });
});

describe("matchBoard — deterministisk tie-break", () => {
  it("vælger efter sort_order når kandidater dækker lige meget", () => {
    const result = matchBoard(
      ["t1"],
      [candidate("sen", 9, true, ["t1"]), candidate("tidlig", 1, true, ["t1"])],
    );

    expect(result.partnerIds[0]).toBe("tidlig");
  });

  it("falder tilbage på navn ved samme sort_order", () => {
    const result = matchBoard(
      ["t1"],
      [
        candidate("b", 1, true, ["t1"], "Bodil"),
        candidate("a", 1, true, ["t1"], "Anders"),
      ],
    );

    expect(result.partnerIds[0]).toBe("a");
  });

  it("giver samme resultat uanset kandidaternes rækkefølge i input", () => {
    const pool = [
      candidate("i1", 1, true, ["t1"]),
      candidate("e1", 2, false, ["t2"]),
      candidate("e2", 3, false, ["t2", "t3"]),
    ];
    const forward = matchBoard(["t1", "t2", "t3"], pool);
    const reversed = matchBoard(["t1", "t2", "t3"], [...pool].reverse());

    expect(reversed.partnerIds).toEqual(forward.partnerIds);
  });
});

describe("matchBoard — små puljer", () => {
  it("NEGATIV: returnerer under minimumsstørrelse når puljen er for lille (board kan ikke godkendes)", () => {
    const result = matchBoard(["t1"], [candidate("i1", 1, true, ["t1"])]);

    expect(result.partnerIds).toEqual(["i1"]);
    expect(result.partnerIds.length).toBeLessThan(MIN_BOARD_SIZE);
  });

  it("NEGATIV: tom pulje giver et tomt board", () => {
    const result = matchBoard(["t1"], []);

    expect(result.partnerIds).toEqual([]);
    expect(result.hasInternalPartner).toBe(false);
    expect(result.uncoveredTagIds).toEqual(["t1"]);
  });
});

describe("computeSwapDelta — kompetence-delta ved udskift", () => {
  const current = [candidate("i1", 1, true, ["t1"]), candidate("e1", 2, false, ["t2"])];

  it("viser hvilke tags der udgår og tilkommer", () => {
    const delta = computeSwapDelta(["t1", "t2", "t3"], current, "e1", candidate("e2", 3, false, ["t3"]));

    expect(delta.removedTagIds).toEqual(["t2"]);
    expect(delta.addedTagIds).toEqual(["t3"]);
  });

  it("melder uændret dækning når erstatteren dækker det samme", () => {
    const delta = computeSwapDelta(["t1", "t2"], current, "e1", candidate("e2", 3, false, ["t2"]));

    expect(delta.removedTagIds).toEqual([]);
    expect(delta.addedTagIds).toEqual([]);
  });

  it("tæller kun tags ejeren faktisk har ønsket", () => {
    const delta = computeSwapDelta(["t1"], current, "e1", candidate("e2", 3, false, ["t9"]));

    expect(delta.removedTagIds).toEqual([]);
    expect(delta.addedTagIds).toEqual([]);
  });

  it("melder intet tabt når en anden partner stadig dækker tagget", () => {
    const overlapping = [candidate("i1", 1, true, ["t1", "t2"]), candidate("e1", 2, false, ["t2"])];
    const delta = computeSwapDelta(["t1", "t2"], overlapping, "e1", candidate("e2", 3, false, []));

    expect(delta.removedTagIds).toEqual([]);
  });
});
