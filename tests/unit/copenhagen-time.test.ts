import { describe, expect, it } from "vitest";

import { copenhagenLocalToIso, copenhagenLocalToUtc } from "@/server/time/copenhagen";

describe("copenhagenLocalToIso — formularens tidspunkt er dansk tid (B-29)", () => {
  it("sommertid: 10:00 dansk er 08:00Z", () => {
    expect(copenhagenLocalToIso("2026-10-12T10:00")).toBe("2026-10-12T08:00:00.000Z");
  });

  it("vintertid: 10:00 dansk er 09:00Z", () => {
    expect(copenhagenLocalToIso("2026-11-02T10:00")).toBe("2026-11-02T09:00:00.000Z");
  });

  it("på efterårets skiftedøgn følger tidspunktet efter skiftet vintertid", () => {
    // 25. oktober 2026 kl. 03:00 sommertid → 02:00 vintertid.
    expect(copenhagenLocalToIso("2026-10-25T10:00")).toBe("2026-10-25T09:00:00.000Z");
    expect(copenhagenLocalToIso("2026-10-25T01:30")).toBe("2026-10-24T23:30:00.000Z");
  });

  it("på forårets skiftedøgn rammer både før og efter skiftet rigtigt", () => {
    // 29. marts 2026 kl. 02:00 vintertid → 03:00 sommertid.
    expect(copenhagenLocalToIso("2026-03-29T01:30")).toBe("2026-03-29T00:30:00.000Z");
    expect(copenhagenLocalToIso("2026-03-29T10:00")).toBe("2026-03-29T08:00:00.000Z");
  });

  it("afviser format og datoer der ikke findes", () => {
    expect(() => copenhagenLocalToIso("2026-10-12")).toThrow(/Ugyldigt/);
    expect(() => copenhagenLocalToIso("2026-02-30T10:00")).toThrow(/Ugyldigt/);
    expect(() => copenhagenLocalToIso("2026-10-12T10:00Z")).toThrow(/Ugyldigt/);
  });

  it("månedsgrænser ligger ved dansk midnat", () => {
    expect(copenhagenLocalToUtc(2026, 11, 1, 0, 0).toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(copenhagenLocalToUtc(2026, 7, 1, 0, 0).toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });
});
