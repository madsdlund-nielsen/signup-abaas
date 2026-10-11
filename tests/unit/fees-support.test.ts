import { describe, expect, it } from "vitest";
import { toCsv } from "@/server/fees/csv";
import {
  copenhagenLocalToIso,
  formatMonth,
  isValidMonth,
  monthOf,
  monthPeriod,
  resolvePeriod,
  shiftMonth,
} from "@/server/fees/period";
import { parseNewFeeRule, type RawFeeRuleInput } from "@/server/fees/rule-input";

/** Periode, CSV og regelvalidering for honoraropgørelsen (fase 5.1/5.2, ADR 0051). Alle rene. */

describe("monthPeriod — kalendermåned i dansk tid", () => {
  it("klipper ved dansk midnat: vintertid er UTC+1", () => {
    expect(monthPeriod("2026-01")).toEqual({
      month: "2026-01",
      from: "2025-12-31T23:00:00.000Z",
      to: "2026-01-31T23:00:00.000Z",
    });
  });

  it("klipper ved dansk midnat: sommertid er UTC+2", () => {
    expect(monthPeriod("2026-07")).toEqual({
      month: "2026-07",
      from: "2026-06-30T22:00:00.000Z",
      to: "2026-07-31T22:00:00.000Z",
    });
  });

  it("håndterer skiftet til og fra sommertid (marts / oktober)", () => {
    // Marts 2026 starter i vintertid og slutter i sommertid.
    expect(monthPeriod("2026-03")).toMatchObject({
      from: "2026-02-28T23:00:00.000Z",
      to: "2026-03-31T22:00:00.000Z",
    });
    // Oktober 2026 starter i sommertid og slutter i vintertid.
    expect(monthPeriod("2026-10")).toMatchObject({
      from: "2026-09-30T22:00:00.000Z",
      to: "2026-10-31T23:00:00.000Z",
    });
  });

  it("december ruller over i næste år", () => {
    expect(monthPeriod("2026-12").to).toBe("2026-12-31T23:00:00.000Z");
  });

  it("et møde kl. 00:30 dansk tid den 1. hører til den NYE måned (ikke UTC-måneden)", () => {
    const meeting = "2026-09-30T22:30:00Z"; // 00:30 den 1. oktober, dansk sommertid
    const october = monthPeriod("2026-10");
    const september = monthPeriod("2026-09");
    expect(meeting >= october.from && meeting < october.to).toBe(true);
    expect(meeting >= september.from && meeting < september.to).toBe(false);
  });

  it("kaster ved ugyldigt format", () => {
    expect(() => monthPeriod("2026-13")).toThrow(/ÅÅÅÅ-MM/);
    expect(() => monthPeriod("26-01")).toThrow();
    expect(() => monthPeriod("")).toThrow();
  });
});

describe("månedshjælpere", () => {
  it("isValidMonth", () => {
    expect(isValidMonth("2026-10")).toBe(true);
    expect(isValidMonth("2026-00")).toBe(false);
    expect(isValidMonth("2026-1")).toBe(false);
    expect(isValidMonth(null)).toBe(false);
    expect(isValidMonth(undefined)).toBe(false);
  });

  it("monthOf bruger dansk tid", () => {
    expect(monthOf(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10");
    expect(monthOf(new Date("2026-09-30T21:30:00Z"))).toBe("2026-09");
  });

  it("shiftMonth går over årsskifter begge veje", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-05", 0)).toBe("2026-05");
    expect(shiftMonth("2026-05", 14)).toBe("2027-07");
    expect(() => shiftMonth("x", 1)).toThrow();
  });

  it("resolvePeriod falder tilbage til indeværende måned ved manglende/ugyldig parameter", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(resolvePeriod(undefined, now).month).toBe("2026-10");
    expect(resolvePeriod("pjat", now).month).toBe("2026-10");
    expect(resolvePeriod("2026-02", now).month).toBe("2026-02");
  });

  it("formatMonth giver dansk månedsnavn med stort begyndelsesbogstav", () => {
    expect(formatMonth("2026-10")).toBe("Oktober 2026");
  });
});

describe("copenhagenLocalToIso — datetime-local som dansk tid", () => {
  it("sommertid: 10:00 lokalt er 08:00 UTC", () => {
    expect(copenhagenLocalToIso("2026-07-01T10:00")).toBe("2026-07-01T08:00:00.000Z");
  });

  it("vintertid: 10:00 lokalt er 09:00 UTC", () => {
    expect(copenhagenLocalToIso("2026-01-15T10:00")).toBe("2026-01-15T09:00:00.000Z");
  });

  it("afviser forkert format og datoer der ikke findes", () => {
    expect(() => copenhagenLocalToIso("2026-07-01")).toThrow(/Ugyldigt/);
    expect(() => copenhagenLocalToIso("2026-02-31T10:00")).toThrow(/Ugyldigt/);
    expect(() => copenhagenLocalToIso("2026-07-01T25:00")).toThrow(/Ugyldigt/);
    expect(() => copenhagenLocalToIso("")).toThrow();
  });
});

describe("toCsv", () => {
  it("skriver header og rækker med CRLF og afsluttende linjeskift", () => {
    expect(toCsv(["a", "b"], [[1, "x"], [2, "y"]])).toBe("a,b\r\n1,x\r\n2,y\r\n");
  });

  it("citerer celler med komma, anførselstegn og linjeskift", () => {
    expect(toCsv(["h"], [['a,b'], ['sig "hej"'], ["to\nlinjer"]])).toBe(
      'h\r\n"a,b"\r\n"sig ""hej"""\r\n"to\nlinjer"\r\n',
    );
  });

  it("tomme og manglende værdier bliver tomme celler; 0 bevares", () => {
    expect(toCsv(["a", "b", "c"], [[null, undefined, 0]])).toBe("a,b,c\r\n,,0\r\n");
  });

  it("neutraliserer formel-injektion i tekst, men rører ikke negative tal", () => {
    const csv = toCsv(["navn", "beloeb"], [["=HYPERLINK(\"x\")", -5], ["+1", 1], ["@sum", 2], ["-x", 3]]);
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\",-5");
    expect(csv).toContain("'+1,1");
    expect(csv).toContain("'@sum,2");
    expect(csv).toContain("'-x,3");
  });
});

describe("parseNewFeeRule — validering af en ny regelversion", () => {
  const NOW = new Date("2026-10-10T12:00:00Z");
  const valid: RawFeeRuleInput = {
    hourlyRate: "6000",
    vatMode: "ikke_fastlagt",
    absenceRule: "ikke_fastlagt",
    effectiveFrom: "2026-11-01T00:00",
  };

  it("accepterer gyldigt input og oversætter gyldighedstidspunktet fra dansk tid", () => {
    expect(parseNewFeeRule(valid, null, NOW)).toEqual({
      ok: true,
      value: {
        hourlyRateMinor: 6000,
        vatMode: "ikke_fastlagt",
        absenceRule: "ikke_fastlagt",
        effectiveFrom: "2026-10-31T23:00:00.000Z",
      },
    });
  });

  it("sats 0 er gyldig (en beslutning), tom sats er det ikke", () => {
    expect(parseNewFeeRule({ ...valid, hourlyRate: "0" }, null, NOW).ok).toBe(true);
    expect(parseNewFeeRule({ ...valid, hourlyRate: "" }, null, NOW)).toMatchObject({ ok: false });
  });

  it("afviser negative, decimale og ikke-numeriske satser", () => {
    for (const hourlyRate of ["-1", "1.5", "abc", " "]) {
      expect(parseNewFeeRule({ ...valid, hourlyRate }, null, NOW)).toMatchObject({
        ok: false,
        error: expect.stringMatching(/sats/),
      });
    }
  });

  it("kræver en eksplicit momsbehandling og afbudsregel fra de kendte værdier", () => {
    expect(parseNewFeeRule({ ...valid, vatMode: "femogtyve" }, null, NOW)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/moms/i),
    });
    expect(parseNewFeeRule({ ...valid, vatMode: "" }, null, NOW).ok).toBe(false);
    expect(parseNewFeeRule({ ...valid, absenceRule: "halvt" }, null, NOW)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/afbud/i),
    });
    for (const vatMode of ["ikke_fastlagt", "ekskl_moms", "inkl_moms"]) {
      expect(parseNewFeeRule({ ...valid, vatMode }, null, NOW).ok).toBe(true);
    }
    for (const absenceRule of ["ikke_fastlagt", "intet_honorar", "fuldt_honorar"]) {
      expect(parseNewFeeRule({ ...valid, absenceRule }, null, NOW).ok).toBe(true);
    }
  });

  it("afviser et ugyldigt gyldighedstidspunkt", () => {
    expect(parseNewFeeRule({ ...valid, effectiveFrom: "" }, null, NOW)).toMatchObject({ ok: false });
    expect(parseNewFeeRule({ ...valid, effectiveFrom: "2026-02-31T00:00" }, null, NOW)).toMatchObject({
      ok: false,
    });
  });

  it("den FØRSTE version må gælde fra fortiden (den skal kunne dække afholdte møder)", () => {
    expect(parseNewFeeRule({ ...valid, effectiveFrom: "2026-01-01T00:00" }, null, NOW).ok).toBe(true);
  });

  it("NEGATIV: en senere version må ikke ligge før eller på den nyeste versions tidspunkt", () => {
    const latest = "2026-12-01T00:00:00.000Z";
    expect(parseNewFeeRule({ ...valid, effectiveFrom: "2026-11-15T00:00" }, latest, NOW)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/efter den nuværende nyeste/),
    });
    // Præcis samme tidspunkt (01-12 00:00 dansk = 30-11 23:00 UTC) overskygger ikke — og er afvist.
    expect(parseNewFeeRule({ ...valid, effectiveFrom: "2026-12-01T00:00" }, "2026-11-30T23:00:00.000Z", NOW).ok).toBe(
      false,
    );
  });

  it("NEGATIV: en senere version må ikke gælde fra fortiden (ville ændre afviklede møder)", () => {
    expect(
      parseNewFeeRule({ ...valid, effectiveFrom: "2026-10-01T00:00" }, "2026-01-01T00:00:00.000Z", NOW),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/fortiden/) });
  });

  it("en senere version fremad i tid accepteres", () => {
    expect(
      parseNewFeeRule({ ...valid, effectiveFrom: "2026-11-01T00:00" }, "2026-01-01T00:00:00.000Z", NOW).ok,
    ).toBe(true);
  });
});
