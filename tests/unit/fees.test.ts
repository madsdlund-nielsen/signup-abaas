import { describe, expect, it } from "vitest";
import {
  computeFeeLine,
  describeFee,
  feeAmountMinor,
  selectFeeRule,
  summarizeFees,
  type FeeComputation,
  type FeeLineInput,
  type FeeRuleInput,
} from "@/server/fees/algorithm";
import { buildFeeLines, groupByPartner, type FeeLineRow } from "@/server/fees/lines";

/**
 * Honorarberegning (fase 5.1, ADR 0051). Algoritmen er DB-fri. Testværdierne er åbenlyst
 * syntetiske (sats 6000 øre/time giver rene tal ved 75 min) — de reelle satser er ejer-
 * uafklarede og indtastes af admin i prod.
 */
function rule(overrides: Partial<FeeRuleInput> = {}): FeeRuleInput {
  return {
    id: "r1",
    version: 1,
    hourlyRateMinor: 6000,
    currency: "DKK",
    vatMode: "ikke_fastlagt",
    absenceRule: "ikke_fastlagt",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function input(overrides: Partial<FeeLineInput> = {}): FeeLineInput {
  return {
    durationMinutes: 60,
    prepMinutes: 15,
    registeredStatus: "afholdt",
    meetingStatus: "afholdt",
    ...overrides,
  };
}

describe("feeAmountMinor — sats × grundlag / 60, afrundet", () => {
  it("regner 75 min som grundlag (60 + 15)", () => {
    expect(feeAmountMinor(6000, 75)).toBe(7500);
    expect(feeAmountMinor(100, 75)).toBe(125);
  });

  it("afrunder til nærmeste øre, aldrig brøkdele", () => {
    // 101 × 75 / 60 = 126,25
    expect(feeAmountMinor(101, 75)).toBe(126);
    // 103 × 75 / 60 = 128,75
    expect(feeAmountMinor(103, 75)).toBe(129);
    expect(Number.isInteger(feeAmountMinor(1, 75))).toBe(true);
  });

  it("sats 0 giver 0 — en beslutning, ikke en manglende værdi", () => {
    expect(feeAmountMinor(0, 75)).toBe(0);
  });

  it("kaster ved ugyldigt input frem for at gætte", () => {
    expect(() => feeAmountMinor(-1, 75)).toThrow(/sats/);
    expect(() => feeAmountMinor(1.5, 75)).toThrow(/sats/);
    expect(() => feeAmountMinor(100, -5)).toThrow(/grundlag/);
    expect(() => feeAmountMinor(100, 7.5)).toThrow(/grundlag/);
  });
});

describe("selectFeeRule — senest gyldige regel for mødetidspunktet", () => {
  const v1 = rule({ id: "v1", version: 1, effectiveFrom: "2026-01-01T00:00:00.000Z" });
  const v2 = rule({ id: "v2", version: 2, effectiveFrom: "2026-06-01T00:00:00.000Z" });
  const v3 = rule({ id: "v3", version: 3, effectiveFrom: "2026-09-01T00:00:00.000Z" });

  it("vælger den version der gjaldt da mødet blev afholdt — historik ændrer sig ikke", () => {
    const rules = [v1, v2, v3];
    expect(selectFeeRule(rules, "2026-03-15T10:00:00Z")?.id).toBe("v1");
    expect(selectFeeRule(rules, "2026-07-01T10:00:00Z")?.id).toBe("v2");
    expect(selectFeeRule(rules, "2026-10-01T10:00:00Z")?.id).toBe("v3");
  });

  it("gyldighedstidspunktet er inklusivt", () => {
    expect(selectFeeRule([v1, v2], "2026-06-01T00:00:00.000Z")?.id).toBe("v2");
    expect(selectFeeRule([v1, v2], "2026-05-31T23:59:59.999Z")?.id).toBe("v1");
  });

  it("returnerer null når ingen regel gælder endnu (mødet ligger før den første)", () => {
    expect(selectFeeRule([v1], "2025-12-31T23:59:59Z")).toBeNull();
    expect(selectFeeRule([], "2026-03-15T10:00:00Z")).toBeNull();
  });

  it("er uafhængig af rækkefølgen reglerne leveres i", () => {
    const at = "2026-07-01T10:00:00Z";
    expect(selectFeeRule([v3, v1, v2], at)?.id).toBe("v2");
    expect(selectFeeRule([v2, v3, v1], at)?.id).toBe("v2");
  });

  it("vælger på effectiveFrom, ikke på versionsnummer", () => {
    // Version 2 med TIDLIGERE gyldighed end version 1: tidspunktet afgør, ikke nummeret.
    const early = rule({ id: "early", version: 2, effectiveFrom: "2026-01-01T00:00:00.000Z" });
    const late = rule({ id: "late", version: 1, effectiveFrom: "2026-06-01T00:00:00.000Z" });
    expect(selectFeeRule([early, late], "2026-07-01T00:00:00Z")?.id).toBe("late");
  });

  it("kaster ved ugyldige tidspunkter", () => {
    expect(() => selectFeeRule([v1], "ikke en dato")).toThrow(/mødetidspunkt/);
    expect(() => selectFeeRule([rule({ effectiveFrom: "nope" })], "2026-01-01T00:00:00Z")).toThrow(
      /gyldighedstidspunkt/,
    );
  });
});

describe("computeFeeLine — afholdt møde", () => {
  it("beregner sats × 75 min og videregiver regel, valuta og momsmåde", () => {
    const result = computeFeeLine(rule({ vatMode: "ekskl_moms" }), input());
    expect(result).toEqual({
      kind: "beregnet",
      amountMinor: 7500,
      currency: "DKK",
      basisMinutes: 75,
      basis: "afholdt",
      vatMode: "ekskl_moms",
      ruleVersion: 1,
    });
  });

  it("følger mødets faktiske minutter, ikke et hårdkodet 75", () => {
    const result = computeFeeLine(rule(), input({ durationMinutes: 90, prepMinutes: 30 }));
    expect(result).toMatchObject({ kind: "beregnet", basisMinutes: 120, amountMinor: 12000 });
  });

  it("beregner ALDRIG moms: beløbet er det samme uanset momsmåde", () => {
    const amounts = (["ikke_fastlagt", "ekskl_moms", "inkl_moms"] as const).map((vatMode) => {
      const result = computeFeeLine(rule({ vatMode }), input());
      return result.kind === "beregnet" ? result.amountMinor : null;
    });
    expect(new Set(amounts)).toEqual(new Set([7500]));
  });

  it("momsmåden 'ikke_fastlagt' videregives som sådan — den bliver aldrig til en antagelse", () => {
    const result = computeFeeLine(rule(), input());
    expect(result.kind === "beregnet" && result.vatMode).toBe("ikke_fastlagt");
  });
});

describe("computeFeeLine — ingen sats, intet grundlag", () => {
  it("ingen regel for tidspunktet → ingen_sats (aldrig 0 kr)", () => {
    expect(computeFeeLine(null, input())).toEqual({ kind: "ingen_sats" });
  });

  it("ikke registreret → ikke_registreret, uanset sats", () => {
    expect(computeFeeLine(rule(), input({ registeredStatus: null }))).toEqual({
      kind: "ikke_registreret",
    });
    expect(computeFeeLine(null, input({ registeredStatus: null }))).toEqual({
      kind: "ikke_registreret",
    });
  });

  it("aflyst møde → aflyst, selv med registrering og sats", () => {
    expect(computeFeeLine(rule(), input({ meetingStatus: "aflyst" }))).toEqual({ kind: "aflyst" });
    expect(
      computeFeeLine(rule({ absenceRule: "fuldt_honorar" }), input({
        meetingStatus: "aflyst",
        registeredStatus: "udeblivelse",
      })),
    ).toEqual({ kind: "aflyst" });
  });

  it("kaster ved ugyldige minutter", () => {
    expect(() => computeFeeLine(rule(), input({ durationMinutes: -1 }))).toThrow(/grundlag/);
    expect(() => computeFeeLine(rule(), input({ prepMinutes: 1.5 }))).toThrow(/grundlag/);
  });
});

describe("computeFeeLine — forsinket afbud og udeblivelse (konsekvensen er ejerens beslutning)", () => {
  for (const status of ["forsinket_afbud", "udeblivelse"] as const) {
    it(`${status} med regel 'ikke_fastlagt' → afventer_regel: grundlaget registreres, intet beløb`, () => {
      const result = computeFeeLine(rule(), input({ registeredStatus: status }));
      expect(result).toEqual({
        kind: "afventer_regel",
        basis: status,
        basisMinutes: 75,
        ruleVersion: 1,
      });
      expect(result).not.toHaveProperty("amountMinor");
    });

    it(`${status} med 'intet_honorar' → beregnet 0 (admin har besluttet det)`, () => {
      const result = computeFeeLine(
        rule({ absenceRule: "intet_honorar" }),
        input({ registeredStatus: status }),
      );
      expect(result).toMatchObject({ kind: "beregnet", amountMinor: 0, basis: status });
    });

    it(`${status} med 'fuldt_honorar' → fuldt beløb`, () => {
      const result = computeFeeLine(
        rule({ absenceRule: "fuldt_honorar" }),
        input({ registeredStatus: status }),
      );
      expect(result).toMatchObject({ kind: "beregnet", amountMinor: 7500, basis: status });
    });

    it(`${status} uden regel → ingen_sats (sats mangler før afbudsreglen kan spille ind)`, () => {
      expect(computeFeeLine(null, input({ registeredStatus: status }))).toEqual({
        kind: "ingen_sats",
      });
    });
  }

  it("afbud på et stadig planlagt møde regnes på registreringen (afbud flipper ikke mødestatus)", () => {
    const result = computeFeeLine(
      rule({ absenceRule: "fuldt_honorar" }),
      input({ meetingStatus: "planlagt", registeredStatus: "forsinket_afbud" }),
    );
    expect(result.kind).toBe("beregnet");
  });
});

describe("summarizeFees — nøgletallene en opgørelse viser først", () => {
  const rates = rule();
  const held = computeFeeLine(rates, input());
  const absentPending = computeFeeLine(rates, input({ registeredStatus: "udeblivelse" }));
  const absentZero = computeFeeLine(
    rule({ absenceRule: "intet_honorar", vatMode: "ekskl_moms" }),
    input({ registeredStatus: "forsinket_afbud" }),
  );

  const results: FeeComputation[] = [
    held,
    held,
    absentPending,
    absentZero,
    computeFeeLine(null, input()),
    computeFeeLine(rates, input({ registeredStatus: null })),
    computeFeeLine(rates, input({ meetingStatus: "aflyst" })),
  ];

  it("summerer kun beregnede linjer og tæller resten hver for sig", () => {
    const totals = summarizeFees(results);
    expect(totals.totalsByCurrency).toEqual([{ currency: "DKK", amountMinor: 15000 }]);
    expect(totals.heldCount).toBe(2);
    expect(totals.calculatedCount).toBe(3);
    expect(totals.awaitingRuleCount).toBe(1);
    expect(totals.noRateCount).toBe(1);
    expect(totals.notRegisteredCount).toBe(1);
    expect(totals.cancelledCount).toBe(1);
  });

  it("samler de momsmåder der optræder (flere = reglen skiftede i perioden)", () => {
    expect(summarizeFees(results).vatModes).toEqual(["ekskl_moms", "ikke_fastlagt"]);
  });

  it("blander aldrig valutaer i én sum", () => {
    const eur = computeFeeLine(rule({ currency: "EUR" }), input());
    const totals = summarizeFees([held, eur]);
    expect(totals.totalsByCurrency).toEqual([
      { currency: "DKK", amountMinor: 7500 },
      { currency: "EUR", amountMinor: 7500 },
    ]);
  });

  it("en tom periode giver nuller og ingen sum", () => {
    expect(summarizeFees([])).toEqual({
      totalsByCurrency: [],
      heldCount: 0,
      calculatedCount: 0,
      awaitingRuleCount: 0,
      noRateCount: 0,
      notRegisteredCount: 0,
      cancelledCount: 0,
      vatModes: [],
    });
  });
});

describe("describeFee — ærlig tekst pr. udfald", () => {
  it("nævner hvorfor en linje ikke har et beløb", () => {
    expect(describeFee({ kind: "ingen_sats" })).toMatch(/sats/);
    expect(describeFee({ kind: "ikke_registreret" })).toMatch(/ikke registreret/);
    expect(describeFee({ kind: "aflyst" })).toMatch(/Aflyst/);
    expect(
      describeFee({ kind: "afventer_regel", basis: "udeblivelse", basisMinutes: 75, ruleVersion: 1 }),
    ).toMatch(/afventer regel/);
  });

  it("skelner almindeligt honorar fra et afgjort afbud", () => {
    expect(describeFee(computeFeeLine(rule(), input()))).toBe("Beregnet");
    expect(
      describeFee(
        computeFeeLine(rule({ absenceRule: "intet_honorar" }), input({ registeredStatus: "udeblivelse" })),
      ),
    ).toMatch(/afbudsregel/);
  });
});

describe("buildFeeLines / groupByPartner — sammenstilling mod regelversionerne", () => {
  const v1 = rule({ id: "v1", version: 1, hourlyRateMinor: 6000, effectiveFrom: "2026-01-01T00:00:00.000Z" });
  const v2 = rule({ id: "v2", version: 2, hourlyRateMinor: 12000, effectiveFrom: "2026-06-01T00:00:00.000Z" });

  function row(overrides: Partial<FeeLineRow>): FeeLineRow {
    return {
      meetingId: "m1",
      partnerProfileId: "p1",
      partnerName: "Partner Én",
      startsAt: "2026-03-01T10:00:00Z",
      meetingStatus: "afholdt",
      durationMinutes: 60,
      prepMinutes: 15,
      registeredStatus: "afholdt",
      ...overrides,
    };
  }

  it("afregner hvert møde efter den regel der gjaldt på dets tidspunkt", () => {
    const lines = buildFeeLines(
      [
        row({ meetingId: "gammelt", startsAt: "2026-03-01T10:00:00Z" }),
        row({ meetingId: "nyt", startsAt: "2026-07-01T10:00:00Z" }),
      ],
      [v1, v2],
    );
    const byId = Object.fromEntries(lines.map((line) => [line.meetingId, line.result]));
    expect(byId.gammelt).toMatchObject({ amountMinor: 7500, ruleVersion: 1 });
    expect(byId.nyt).toMatchObject({ amountMinor: 15000, ruleVersion: 2 });
  });

  it("uden regler får ingen linje et beløb", () => {
    const lines = buildFeeLines([row({})], []);
    expect(lines[0]?.result).toEqual({ kind: "ingen_sats" });
    expect(lines[0]?.rule).toBeNull();
  });

  it("sorterer nyeste møde først, derefter partnernavn", () => {
    const lines = buildFeeLines(
      [
        row({ meetingId: "a", startsAt: "2026-03-01T10:00:00Z", partnerName: "Zoe" }),
        row({ meetingId: "b", startsAt: "2026-04-01T10:00:00Z", partnerName: "Mads" }),
        row({ meetingId: "c", startsAt: "2026-03-01T10:00:00Z", partnerName: "Åse" }),
        row({ meetingId: "d", startsAt: "2026-03-01T10:00:00Z", partnerName: "Anna" }),
      ],
      [v1],
    );
    expect(lines.map((line) => line.meetingId)).toEqual(["b", "d", "a", "c"]);
  });

  it("grupperer pr. partner i navnerækkefølge", () => {
    const lines = buildFeeLines(
      [
        row({ meetingId: "a", partnerProfileId: "p2", partnerName: "Bo" }),
        row({ meetingId: "b", partnerProfileId: "p1", partnerName: "Anna" }),
        row({ meetingId: "c", partnerProfileId: "p2", partnerName: "Bo", startsAt: "2026-04-01T10:00:00Z" }),
      ],
      [v1],
    );
    const groups = groupByPartner(lines);
    expect(groups.map((group) => [group.partnerName, group.lines.length])).toEqual([
      ["Anna", 1],
      ["Bo", 2],
    ]);
  });
});
