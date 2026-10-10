import { describe, expect, it } from "vitest";

import { parseAbsenceInput, parseSlotInput } from "@/server/availability/validation";

describe("parseSlotInput", () => {
  it("accepterer ugedage + tidsrum, sorterer og fjerner dubletter", () => {
    expect(
      parseSlotInput({ weekdays: ["3", "1", "3"], startTime: "09:00", endTime: "12:30" }),
    ).toEqual({ weekdays: [1, 3], startTime: "09:00", endTime: "12:30" });
  });

  it("kræver mindst én ugedag", () => {
    expect(() => parseSlotInput({ weekdays: [], startTime: "09:00", endTime: "12:00" })).toThrow(
      "Vælg mindst én ugedag.",
    );
  });

  it("afviser ugedage uden for 1-7", () => {
    for (const bad of ["0", "8", "x", "1.5"]) {
      expect(() =>
        parseSlotInput({ weekdays: [bad], startTime: "09:00", endTime: "12:00" }),
      ).toThrow("Ugyldig ugedag.");
    }
  });

  it("afviser ugyldige klokkeslæt", () => {
    for (const bad of ["", "9", "24:00", "09:60", "ni"]) {
      expect(() =>
        parseSlotInput({ weekdays: ["1"], startTime: bad, endTime: "12:00" }),
      ).toThrow("klokkeslæt");
    }
  });

  it("slut skal ligge efter start — også ved lighed", () => {
    expect(() =>
      parseSlotInput({ weekdays: ["1"], startTime: "12:00", endTime: "12:00" }),
    ).toThrow("efter starttidspunktet");
    expect(() =>
      parseSlotInput({ weekdays: ["1"], startTime: "13:00", endTime: "12:00" }),
    ).toThrow("efter starttidspunktet");
  });
});

describe("parseAbsenceInput", () => {
  it("accepterer en periode og trimmer noten", () => {
    expect(
      parseAbsenceInput({ startsOn: "2026-10-12", endsOn: "2026-10-14", note: "  ferie  " }),
    ).toEqual({ startsOn: "2026-10-12", endsOn: "2026-10-14", note: "ferie" });
  });

  it("en tom note bliver null; samme dag er gyldig", () => {
    expect(parseAbsenceInput({ startsOn: "2026-10-12", endsOn: "2026-10-12", note: " " })).toEqual({
      startsOn: "2026-10-12",
      endsOn: "2026-10-12",
      note: null,
    });
  });

  it("afviser manglende, forkert formaterede og umulige datoer", () => {
    for (const bad of ["", "12-10-2026", "2026-02-30", "2026-13-01"]) {
      expect(() => parseAbsenceInput({ startsOn: bad, endsOn: "2026-10-14", note: "" })).toThrow(
        "fra- og til-dato",
      );
    }
  });

  it("til-datoen må ikke ligge før fra-datoen", () => {
    expect(() =>
      parseAbsenceInput({ startsOn: "2026-10-14", endsOn: "2026-10-12", note: "" }),
    ).toThrow("før fra-datoen");
  });

  it("noten har en øvre grænse", () => {
    expect(() =>
      parseAbsenceInput({ startsOn: "2026-10-12", endsOn: "2026-10-12", note: "x".repeat(501) }),
    ).toThrow("500 tegn");
    expect(
      parseAbsenceInput({ startsOn: "2026-10-12", endsOn: "2026-10-12", note: "x".repeat(500) })
        .note,
    ).toHaveLength(500);
  });
});
