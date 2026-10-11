import { describe, expect, it } from "vitest";
import {
  BILLING_PERIOD_DAYS,
  addDays,
  copenhagenDate,
  currentAndNextPeriod,
  formatCalendarDate,
  lastDayOf,
  nextPeriod,
  periodContaining,
} from "@/server/charges/periods";

/**
 * Faktureringsperioder (B-19, ADR 0034/0056): hver 4. uge = 28 dage fra billing_anchor, regnet i
 * danske kalenderdatoer. Alle datoer her er rene test-datoer — der er intet forretningstal i dem.
 */
const ANCHOR = "2026-10-01";

describe("perioder: 28 dage fra ankeret", () => {
  it("kadencen er 28 dage (4 uger)", () => {
    expect(BILLING_PERIOD_DAYS).toBe(28);
  });

  it("ankerdagen åbner første periode [anchor, anchor+28)", () => {
    expect(periodContaining(ANCHOR, "2026-10-01")).toEqual({ start: "2026-10-01", end: "2026-10-29" });
  });

  it("sidste dag i perioden hører stadig til den; dagen efter åbner den næste (halvåben)", () => {
    expect(periodContaining(ANCHOR, "2026-10-28")?.start).toBe("2026-10-01");
    expect(periodContaining(ANCHOR, "2026-10-29")).toEqual({ start: "2026-10-29", end: "2026-11-26" });
  });

  it("perioderne slutter tæt: end er næste periodes start, uden huller", () => {
    const first = periodContaining(ANCHOR, "2026-10-01");
    const second = periodContaining(ANCHOR, first!.end);
    expect(second?.start).toBe(first?.end);
  });

  it("langt ude: den 11. periode starter 280 dage efter ankeret", () => {
    const period = periodContaining(ANCHOR, addDays(ANCHOR, 280));
    expect(period?.start).toBe(addDays(ANCHOR, 280));
    const inside = periodContaining(ANCHOR, addDays(ANCHOR, 280 + 27));
    expect(inside?.start).toBe(addDays(ANCHOR, 280));
  });

  it("NEGATIV: før ankeret findes ingen indeværende periode", () => {
    expect(periodContaining(ANCHOR, "2026-09-30")).toBeNull();
  });

  it("regner i kalenderdage hen over sommertid og årsskifte", () => {
    // Skifte til vintertid 2026-10-25 og årsskifte ligger begge i kæden — datoerne skrider ikke.
    expect(periodContaining("2026-10-01", "2026-12-24")).toEqual({ start: "2026-12-24", end: "2027-01-21" });
    expect(periodContaining("2027-02-10", "2027-03-10")?.start).toBe("2027-03-10");
    // Skudår: 28 dage fra 2028-02-15 lander på 2028-03-14 (29. februar findes).
    expect(periodContaining("2028-02-15", "2028-02-15")?.end).toBe("2028-03-14");
  });
});

describe("næste periode", () => {
  it("er perioden lige efter den indeværende", () => {
    expect(nextPeriod(ANCHOR, "2026-10-10")).toEqual({ start: "2026-10-29", end: "2026-11-26" });
  });

  it("før ankeret er den næste periode den første", () => {
    expect(nextPeriod(ANCHOR, "2026-09-01")).toEqual({ start: "2026-10-01", end: "2026-10-29" });
  });
});

describe("opsigelse: ingen nye perioder efter opsigelsesdatoen", () => {
  it("indeværende periode (startet før opsigelsen) bevares; den næste oprettes ikke", () => {
    const cancelled = "2026-10-15";
    expect(periodContaining(ANCHOR, "2026-10-20", cancelled)?.start).toBe("2026-10-01");
    expect(nextPeriod(ANCHOR, "2026-10-20", cancelled)).toBeNull();
  });

  it("en periode der starter PÅ opsigelsesdagen tæller; dagen efter gør ikke", () => {
    expect(nextPeriod(ANCHOR, "2026-10-20", "2026-10-29")?.start).toBe("2026-10-29");
    expect(nextPeriod(ANCHOR, "2026-10-20", "2026-10-28")).toBeNull();
  });

  it("efter opsigelsen er der ingen indeværende periode i nye perioder", () => {
    expect(periodContaining(ANCHOR, "2026-11-05", "2026-10-15")).toBeNull();
  });
});

describe("danske datoer, uafhængigt af serverens zone", () => {
  it("23:30 UTC 30/6 er allerede 1/7 i København (sommertid, UTC+2)", () => {
    expect(copenhagenDate(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  });

  it("22:30 UTC 30/1 er 30/1 i København (vintertid, UTC+1) — ikke 31/1", () => {
    expect(copenhagenDate(new Date("2027-01-30T22:30:00Z"))).toBe("2027-01-30");
    expect(copenhagenDate(new Date("2027-01-30T23:30:00Z"))).toBe("2027-01-31");
  });

  it("currentAndNextPeriod bruger den danske dato", () => {
    // 2026-10-28 23:30 UTC = 2026-10-29 00:30 dansk tid → den næste periode er allerede åbnet.
    const { current, next } = currentAndNextPeriod(ANCHOR, null, new Date("2026-10-28T23:30:00Z"));
    expect(current?.start).toBe("2026-10-29");
    expect(next?.start).toBe("2026-11-26");
  });

  it("currentAndNextPeriod før ankeret: ingen indeværende, første periode er næste", () => {
    const { current, next } = currentAndNextPeriod(ANCHOR, null, new Date("2026-09-15T10:00:00Z"));
    expect(current).toBeNull();
    expect(next?.start).toBe("2026-10-01");
  });
});

describe("dato-hjælpere", () => {
  it("addDays og lastDayOf", () => {
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
    expect(addDays("2026-03-02", -3)).toBe("2026-02-27");
    expect(lastDayOf({ start: "2026-10-01", end: "2026-10-29" })).toBe("2026-10-28");
  });

  it("formatCalendarDate giver en dansk dato", () => {
    expect(formatCalendarDate("2026-11-04")).toMatch(/4\. november 2026/);
  });

  it("NEGATIV: ugyldige datoer afvises højlydt", () => {
    expect(() => addDays("2026-13-01", 1)).toThrow(/Ugyldig dato/);
    expect(() => addDays("2026-02-30", 1)).toThrow(/findes ikke/);
    expect(() => periodContaining("i dag", "2026-10-01")).toThrow(/Ugyldig dato/);
    expect(() => formatCalendarDate("01-10-2026")).toThrow(/Ugyldig dato/);
  });
});
