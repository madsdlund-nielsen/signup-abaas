import { describe, expect, it } from "vitest";

import {
  copenhagenDateOf,
  findCommonWindows,
  findUnavailable,
  isPartnerAvailable,
  type AbsencePeriod,
  type AvailabilitySlot,
} from "@/server/availability/algorithm";

/**
 * Kalenderfakta (Europe/Copenhagen, 2026) som testene hviler på:
 *   - Sommertid (UTC+2): 2026-03-29 kl. 01:00Z til 2026-10-25 kl. 01:00Z.
 *   - Forårsskifte søndag 2026-03-29: 02:00 → 03:00 (02:xx findes ikke).
 *   - Efterårsskifte søndag 2026-10-25: 03:00 → 02:00 (02:xx findes to gange).
 *   - Mandag 2026-10-12 (sommer), mandag 2026-11-02 (vinter), søndag 2026-10-18.
 * Tidspunkter i testene er skrevet som UTC ("Z"), så ingen test afhænger af maskinens tidszone.
 */

const slot = (weekday: number, startTime: string, endTime: string): AvailabilitySlot => ({
  weekday,
  startTime,
  endTime,
});
const absence = (startsOn: string, endsOn: string): AbsencePeriod => ({ startsOn, endsOn });
const at = (iso: string) => new Date(iso);

describe("isPartnerAvailable — ugevinduer", () => {
  const monMorning = [slot(1, "09:00", "12:00")];

  it("ledig inde i vinduet (sommertid: 09:00 dansk = 07:00Z)", () => {
    expect(isPartnerAvailable(monMorning, [], at("2026-10-12T07:00:00Z"), 60)).toBe(true);
  });

  it("vinduets grænser er inklusive: starter ved start og slutter ved slut", () => {
    expect(isPartnerAvailable(monMorning, [], at("2026-10-12T07:00:00Z"), 180)).toBe(true);
    expect(isPartnerAvailable(monMorning, [], at("2026-10-12T09:00:00Z"), 60)).toBe(true);
  });

  it("ét minut udenfor på hver side er ikke ledig", () => {
    expect(isPartnerAvailable(monMorning, [], at("2026-10-12T06:59:00Z"), 60)).toBe(false);
    expect(isPartnerAvailable(monMorning, [], at("2026-10-12T09:01:00Z"), 60)).toBe(false);
    expect(isPartnerAvailable(monMorning, [], at("2026-10-12T07:00:00Z"), 181)).toBe(false);
  });

  it("forkert ugedag er ikke ledig", () => {
    expect(isPartnerAvailable(monMorning, [], at("2026-10-13T07:00:00Z"), 60)).toBe(false);
  });

  it("tolker vinduet i dansk tid, ikke UTC — vinter og sommer giver forskellig UTC", () => {
    // Samme vægurstid 09:00 mandag: 08:00Z om vinteren (UTC+1), 07:00Z om sommeren (UTC+2).
    expect(isPartnerAvailable(monMorning, [], at("2026-11-02T08:00:00Z"), 60)).toBe(true);
    expect(isPartnerAvailable(monMorning, [], at("2026-11-02T07:00:00Z"), 60)).toBe(false);
    expect(isPartnerAvailable(monMorning, [], at("2026-10-12T08:00:00Z"), 60)).toBe(true);
    expect(isPartnerAvailable(monMorning, [], at("2026-10-12T06:00:00Z"), 60)).toBe(false);
  });

  it("to sammenhængende vinduer dækker et møde der krydser skillelinjen", () => {
    const slots = [slot(1, "09:00", "12:00"), slot(1, "12:00", "15:00")];
    expect(isPartnerAvailable(slots, [], at("2026-10-12T09:30:00Z"), 60)).toBe(true); // 11:30-12:30
  });

  it("et hul mellem to vinduer er ikke ledigt", () => {
    const slots = [slot(1, "09:00", "11:00"), slot(1, "12:00", "15:00")];
    expect(isPartnerAvailable(slots, [], at("2026-10-12T08:30:00Z"), 90)).toBe(false); // 10:30-12:00
  });

  it("overlappende vinduer slås sammen", () => {
    const slots = [slot(1, "09:00", "11:00"), slot(1, "10:00", "13:00")];
    expect(isPartnerAvailable(slots, [], at("2026-10-12T08:00:00Z"), 120)).toBe(true); // 10-12
  });

  it("accepterer Postgres' time-format med sekunder", () => {
    expect(
      isPartnerAvailable([slot(1, "09:00:00", "12:00:00")], [], at("2026-10-12T07:00:00Z"), 60),
    ).toBe(true);
  });

  it("søndag er ISO-ugedag 7", () => {
    const sunday = [slot(7, "10:00", "12:00")];
    expect(isPartnerAvailable(sunday, [], at("2026-10-18T08:00:00Z"), 60)).toBe(true); // 10:00
    expect(isPartnerAvailable([slot(1, "10:00", "12:00")], [], at("2026-10-18T08:00:00Z"), 60)).toBe(
      false,
    );
  });

  it("et vindue til midnat (24:00) og et efter midnat dækker et møde over dagsskiftet", () => {
    const slots = [slot(1, "22:00", "24:00"), slot(2, "00:00", "02:00")];
    expect(isPartnerAvailable(slots, [], at("2026-10-12T21:30:00Z"), 60)).toBe(true); // 23:30-00:30
    expect(isPartnerAvailable([slot(1, "22:00", "24:00")], [], at("2026-10-12T21:30:00Z"), 60)).toBe(
      false,
    );
  });

  it("afviser ugyldigt input højlydt", () => {
    expect(() => isPartnerAvailable([], [], new Date("nonsens"), 60)).toThrow(RangeError);
    expect(() => isPartnerAvailable([], [], at("2026-10-12T07:00:00Z"), 0)).toThrow(RangeError);
    expect(() =>
      isPartnerAvailable([slot(1, "9am", "12:00")], [], at("2026-10-12T07:00:00Z"), 60),
    ).toThrow(RangeError);
    expect(() =>
      isPartnerAvailable([slot(1, "09:60", "12:00")], [], at("2026-10-12T07:00:00Z"), 60),
    ).toThrow(RangeError);
    expect(() =>
      isPartnerAvailable([], [absence("i morgen", "i morgen")], at("2026-10-12T07:00:00Z"), 60),
    ).toThrow(RangeError);
  });
});

describe("isPartnerAvailable — ikke angivet = ingen begrænsning (TODO(ejer))", () => {
  it("en partner uden vinduer og fravær er ledig på ethvert tidspunkt", () => {
    expect(isPartnerAvailable([], [], at("2026-10-12T02:00:00Z"), 60)).toBe(true);
    expect(isPartnerAvailable([], [], at("2026-10-18T22:30:00Z"), 60)).toBe(true);
  });

  it("fravær gælder også uden angivne vinduer", () => {
    const away = [absence("2026-10-12", "2026-10-12")];
    expect(isPartnerAvailable([], away, at("2026-10-12T08:00:00Z"), 60)).toBe(false);
    expect(isPartnerAvailable([], away, at("2026-10-13T08:00:00Z"), 60)).toBe(true);
  });
});

describe("isPartnerAvailable — fravær", () => {
  const monMorning = [slot(1, "09:00", "12:00")];

  it("fravær der dækker dagen afviser selv inde i et ugevindue", () => {
    expect(
      isPartnerAvailable(monMorning, [absence("2026-10-12", "2026-10-12")], at("2026-10-12T08:00:00Z"), 60),
    ).toBe(false);
  });

  it("fravær på en anden dag ændrer intet", () => {
    expect(
      isPartnerAvailable(monMorning, [absence("2026-10-13", "2026-10-15")], at("2026-10-12T08:00:00Z"), 60),
    ).toBe(true);
  });

  it("begge ender af fraværet er inklusive (dansk dato, ikke UTC)", () => {
    const away = [absence("2026-10-10", "2026-10-12")];
    // Mandag 12. 23:00-24:00 dansk (21:00Z) er stadig fravær; tirsdag 00:00 dansk er ikke.
    expect(isPartnerAvailable([], away, at("2026-10-12T21:00:00Z"), 60)).toBe(false);
    expect(isPartnerAvailable([], away, at("2026-10-12T22:00:00Z"), 60)).toBe(true);
    // Første fraværsdag begynder ved dansk midnat (lørdag 10. 00:00 = fredag 22:00Z).
    expect(isPartnerAvailable([], away, at("2026-10-09T22:00:00Z"), 60)).toBe(false);
    expect(isPartnerAvailable([], away, at("2026-10-09T20:59:00Z"), 60)).toBe(true);
  });

  it("et møde der krydser midnat ind i en fraværsdag afvises", () => {
    // 23:30 søndag 11. → 00:30 mandag 12. (21:30Z)
    expect(isPartnerAvailable([], [absence("2026-10-12", "2026-10-12")], at("2026-10-11T21:30:00Z"), 60)).toBe(
      false,
    );
  });

  it("ét-dags fravær midt i en flerdags-periode", () => {
    const away = [absence("2026-10-13", "2026-10-13")];
    expect(isPartnerAvailable([], away, at("2026-10-14T08:00:00Z"), 60)).toBe(true);
    expect(isPartnerAvailable([], away, at("2026-10-13T08:00:00Z"), 60)).toBe(false);
  });
});

describe("isPartnerAvailable — sommertidsskift", () => {
  it("forår: vindue 01:00-05:00 søndag er kun tre reelle timer", () => {
    const slots = [slot(7, "01:00", "05:00")]; // 00:00Z → 03:00Z den 29. marts
    expect(isPartnerAvailable(slots, [], at("2026-03-29T00:00:00Z"), 180)).toBe(true);
    expect(isPartnerAvailable(slots, [], at("2026-03-29T00:00:00Z"), 181)).toBe(false);
    // 04:00 dansk sommertid (02:00Z) til 05:00 (03:00Z) er inden for vinduet
    expect(isPartnerAvailable(slots, [], at("2026-03-29T02:00:00Z"), 60)).toBe(true);
    // 04:30 → 05:30 stikker ud
    expect(isPartnerAvailable(slots, [], at("2026-03-29T02:30:00Z"), 60)).toBe(false);
  });

  it("forår: et vindue der kun ligger i hullet (02:00-03:00) findes ikke", () => {
    const slots = [slot(7, "02:00", "03:00")];
    expect(isPartnerAvailable(slots, [], at("2026-03-29T01:00:00Z"), 60)).toBe(false); // 03:00-04:00
    expect(isPartnerAvailable(slots, [], at("2026-03-29T00:00:00Z"), 30)).toBe(false); // 01:00 vinter
  });

  it("forår: mandagen efter skiftet bruger sommertid (09:00 = 07:00Z)", () => {
    expect(isPartnerAvailable([slot(1, "09:00", "10:00")], [], at("2026-03-30T07:00:00Z"), 60)).toBe(
      true,
    );
    // Mandagen FØR skiftet er vinter: 09:00 = 08:00Z
    expect(isPartnerAvailable([slot(1, "09:00", "10:00")], [], at("2026-03-23T08:00:00Z"), 60)).toBe(
      true,
    );
    expect(isPartnerAvailable([slot(1, "09:00", "10:00")], [], at("2026-03-23T07:00:00Z"), 60)).toBe(
      false,
    );
  });

  it("efterår: vindue 02:00-03:00 søndag dækker begge forekomster af den dobbelte time", () => {
    const slots = [slot(7, "02:00", "03:00")]; // 00:00Z → 02:00Z den 25. oktober
    expect(isPartnerAvailable(slots, [], at("2026-10-25T00:00:00Z"), 120)).toBe(true);
    expect(isPartnerAvailable(slots, [], at("2026-10-25T00:00:00Z"), 90)).toBe(true); // over skiftet
    expect(isPartnerAvailable(slots, [], at("2026-10-25T01:00:00Z"), 60)).toBe(true); // 2. forekomst
    expect(isPartnerAvailable(slots, [], at("2026-10-25T01:30:00Z"), 60)).toBe(false); // stikker ud
    expect(isPartnerAvailable(slots, [], at("2026-10-24T23:30:00Z"), 60)).toBe(false); // starter før
  });

  it("efterår: dagen er 25 timer lang — et vindue 00:00-24:00 dækker dem alle", () => {
    const wholeDay = [slot(7, "00:00", "24:00")];
    expect(isPartnerAvailable(wholeDay, [], at("2026-10-24T22:00:00Z"), 25 * 60)).toBe(true);
    expect(isPartnerAvailable(wholeDay, [], at("2026-10-24T22:00:00Z"), 25 * 60 + 1)).toBe(false);
  });

  it("efterår: mandagen efter skiftet bruger vintertid (09:00 = 08:00Z)", () => {
    expect(isPartnerAvailable([slot(1, "09:00", "10:00")], [], at("2026-10-26T08:00:00Z"), 60)).toBe(
      true,
    );
    expect(isPartnerAvailable([slot(1, "09:00", "10:00")], [], at("2026-10-26T07:00:00Z"), 60)).toBe(
      false,
    );
  });

  it("fravær på skiftedagen varer 25 timer — fra dansk midnat til dansk midnat", () => {
    const away = [absence("2026-10-25", "2026-10-25")]; // 24.10 22:00Z → 25.10 23:00Z
    expect(isPartnerAvailable([], away, at("2026-10-24T21:00:00Z"), 60)).toBe(true); // lørdag 23:00
    expect(isPartnerAvailable([], away, at("2026-10-24T22:00:00Z"), 60)).toBe(false); // søn 00:00
    expect(isPartnerAvailable([], away, at("2026-10-25T22:00:00Z"), 60)).toBe(false); // søn 23:00
    expect(isPartnerAvailable([], away, at("2026-10-25T23:00:00Z"), 60)).toBe(true); // man 00:00
  });
});

describe("findUnavailable", () => {
  it("returnerer de partnere der ikke er ledige — og kun dem", () => {
    const partners = [
      { name: "Åse", calendar: { slots: [slot(1, "09:00", "12:00")], absences: [] } },
      { name: "Bo", calendar: { slots: [slot(1, "13:00", "17:00")], absences: [] } },
      { name: "Cecilie", calendar: { slots: [], absences: [] } },
    ];
    const result = findUnavailable(partners, at("2026-10-12T08:00:00Z"), 60); // 10:00 dansk
    expect(result.map((p) => p.name)).toEqual(["Bo"]);
  });

  it("tom liste når alle er ledige", () => {
    expect(findUnavailable([{ name: "A", calendar: { slots: [], absences: [] } }], at("2026-10-12T08:00:00Z"), 60)).toEqual([]);
  });
});

describe("findCommonWindows", () => {
  const week = { startDate: "2026-10-12" }; // mandag, sommertid

  it("fællesmængden af to partneres ugevinduer; ubegrænset partner bidrager med hele ugen", () => {
    const { windows, anyRestriction } = findCommonWindows(
      [
        { slots: [slot(1, "09:00", "12:00"), slot(2, "10:00", "14:00")], absences: [] },
        { slots: [slot(1, "10:00", "15:00")], absences: [] },
        { slots: [], absences: [] },
      ],
      week,
    );
    expect(anyRestriction).toBe(true);
    expect(windows).toEqual([
      { start: at("2026-10-12T08:00:00Z"), end: at("2026-10-12T10:00:00Z") }, // man 10-12 dansk
    ]);
  });

  it("ingen fælles tid → tom liste (men stadig begrænset)", () => {
    const result = findCommonWindows(
      [
        { slots: [slot(1, "09:00", "11:00")], absences: [] },
        { slots: [slot(1, "12:00", "15:00")], absences: [] },
      ],
      week,
    );
    expect(result.windows).toEqual([]);
    expect(result.anyRestriction).toBe(true);
  });

  it("fravær trækkes fra, og meldes som begrænsning selv uden ugevinduer", () => {
    const result = findCommonWindows(
      [{ slots: [], absences: [absence("2026-10-13", "2026-10-17")] }],
      week,
    );
    expect(result.anyRestriction).toBe(true);
    expect(result.windows).toEqual([
      // Mandag 12. er fri; tirsdag 13. til og med lørdag 17. er fravær; søndag 18. er fri igen.
      // (Sidste fraværsdag, lørdag 17., er inklusive — derfor starter søndagens vindue 17.-18.)
      { start: at("2026-10-11T22:00:00Z"), end: at("2026-10-12T22:00:00Z") },
      { start: at("2026-10-17T22:00:00Z"), end: at("2026-10-18T22:00:00Z") },
    ]);
  });

  it("ingen begrænsninger → anyRestriction falsk og hele perioden som ét vindue", () => {
    const result = findCommonWindows([{ slots: [], absences: [] }], week);
    expect(result.anyRestriction).toBe(false);
    expect(result.windows).toEqual([
      { start: at("2026-10-11T22:00:00Z"), end: at("2026-10-18T22:00:00Z") },
    ]);
  });

  it("fravær udenfor perioden er ikke en begrænsning", () => {
    const result = findCommonWindows(
      [{ slots: [], absences: [absence("2026-12-01", "2026-12-24")] }],
      week,
    );
    expect(result.anyRestriction).toBe(false);
  });

  it("ingen partnere → hele perioden, ubegrænset", () => {
    const result = findCommonWindows([], week);
    expect(result.anyRestriction).toBe(false);
    expect(result.windows).toHaveLength(1);
  });

  it("minimumMinutes filtrerer for korte vinduer fra", () => {
    const partners = [
      { slots: [slot(1, "09:00", "11:00")], absences: [] },
      { slots: [slot(1, "10:30", "12:00")], absences: [] },
    ];
    expect(findCommonWindows(partners, { ...week, minimumMinutes: 0 }).windows).toHaveLength(1);
    expect(findCommonWindows(partners, { ...week, minimumMinutes: 31 }).windows).toHaveLength(0);
    expect(findCommonWindows(partners, { ...week, minimumMinutes: 30 }).windows).toHaveLength(1);
  });

  it("notBefore beskærer fortiden", () => {
    const { windows } = findCommonWindows(
      [{ slots: [slot(1, "09:00", "12:00")], absences: [] }],
      { ...week, notBefore: at("2026-10-12T09:00:00Z") }, // 11:00 dansk
    );
    expect(windows).toEqual([{ start: at("2026-10-12T09:00:00Z"), end: at("2026-10-12T10:00:00Z") }]);
  });

  it("en uge over efterårsskiftet er 169 timer; ugevinduer følger dansk tid på begge sider", () => {
    const result = findCommonWindows([], { startDate: "2026-10-19" });
    const [only] = result.windows;
    expect(only).toBeDefined();
    expect((only!.end.getTime() - only!.start.getTime()) / 3_600_000).toBe(169);

    const { windows } = findCommonWindows(
      [{ slots: [slot(1, "09:00", "10:00"), slot(7, "09:00", "10:00")], absences: [] }],
      { startDate: "2026-10-19" },
    );
    expect(windows).toEqual([
      { start: at("2026-10-19T07:00:00Z"), end: at("2026-10-19T08:00:00Z") }, // man 19.: sommertid
      { start: at("2026-10-25T08:00:00Z"), end: at("2026-10-25T09:00:00Z") }, // søn 25.: vintertid
    ]);
  });

  it("afviser en ugyldig startdato højlydt", () => {
    expect(() => findCommonWindows([], { startDate: "12/10/2026" })).toThrow(RangeError);
  });
});

describe("copenhagenDateOf", () => {
  it("giver dansk kalenderdato, ikke UTC-dato", () => {
    expect(copenhagenDateOf(at("2026-10-12T22:30:00Z"))).toBe("2026-10-13"); // 00:30 dansk
    expect(copenhagenDateOf(at("2026-10-12T21:30:00Z"))).toBe("2026-10-12");
    expect(copenhagenDateOf(at("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
});
