import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getBoardCommonWindows,
  getMyAvailability,
  readBoardCalendars,
} from "@/server/availability";
import {
  assertBoardAvailable,
  assertMeetingBoardAvailable,
  unavailableMessage,
} from "@/server/availability/guard";

// Auth-laget mockes kun for getBoardCommonWindows' rolle- og ejerskabstjek; alt andet i filen
// kører mod en fake Supabase-klient (ingen netværk).
const mocked = vi.hoisted(() => ({ service: null as unknown, user: null as unknown }));
vi.mock("@/server/auth/supabase-server", () => ({
  createServiceSupabase: () => mocked.service,
  createServerSupabase: async () => mocked.service,
}));
vi.mock("@/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth")>()),
  getCurrentUser: async () => mocked.user,
}));

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "a",
  SUPABASE_SERVICE_ROLE_KEY: "s",
};

type Rows = Record<string, unknown[] | { error: string }>;

/** Minimal fake af PostgREST-kæden: from().select().eq()/in().order() → {data, error}. */
function fakeService(tables: Rows): SupabaseClient {
  const builder = (name: string) => {
    const source = tables[name] ?? [];
    const failure = !Array.isArray(source) ? { message: source.error } : null;
    const result = failure ? { data: null, error: failure } : { data: source, error: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      maybeSingle: async () => ({
        data: Array.isArray(source) ? (source[0] ?? null) : null,
        error: failure,
      }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  };
  return { from: builder } as unknown as SupabaseClient;
}

const MON_09_12 = {
  partner_profile_id: "p1",
  weekday: 1,
  start_time: "09:00:00",
  end_time: "12:00:00",
};
const board = [
  { partner_id: "p1", partner_profile: { name: "Partner Én" } },
  { partner_id: "p2", partner_profile: [{ name: "Partner To" }] },
];

describe("uden Supabase-konfiguration (kontofri CI/dev)", () => {
  it("getMyAvailability giver tomme lister", async () => {
    await expect(getMyAvailability("p1", {})).resolves.toEqual({ slots: [], absences: [] });
  });

  it("getBoardCommonWindows giver null", async () => {
    await expect(getBoardCommonWindows("b1", {})).resolves.toBeNull();
  });
});

describe("unavailableMessage", () => {
  it("navngiver én, to og flere", () => {
    expect(unavailableMessage(["Åse"])).toBe(
      "Mødet kan ikke bookes: Åse er ikke ledig på det valgte tidspunkt. Vælg et andet tidspunkt.",
    );
    expect(unavailableMessage(["Åse", "Bo"])).toContain("Åse og Bo er ikke ledige");
    expect(unavailableMessage(["Åse", "Bo", "Cecilie"])).toContain(
      "Åse, Bo og Cecilie er ikke ledige",
    );
  });
});

describe("assertBoardAvailable — booking-vagten", () => {
  const service = fakeService({
    board_partner: board,
    partner_availability: [MON_09_12],
    partner_absence: [],
  });

  it("slipper igennem når alle med angivet tilgængelighed er ledige (Partner To har intet angivet)", async () => {
    await expect(
      assertBoardAvailable(service, "b1", "2026-10-12T07:00:00Z"),
    ).resolves.toBeUndefined();
  });

  it("afviser og navngiver den partner der ikke er ledig", async () => {
    await expect(assertBoardAvailable(service, "b1", "2026-10-12T12:00:00Z")).rejects.toThrow(
      "Partner Én er ikke ledig",
    );
  });

  it("navngiver alle, når flere ikke er ledige", async () => {
    const both = fakeService({
      board_partner: board,
      partner_availability: [MON_09_12, { ...MON_09_12, partner_profile_id: "p2" }],
      partner_absence: [],
    });
    await expect(assertBoardAvailable(both, "b1", "2026-10-13T07:00:00Z")).rejects.toThrow(
      "Partner Én og Partner To er ikke ledige",
    );
  });

  it("fravær afviser selv uden angivne ugevinduer", async () => {
    const away = fakeService({
      board_partner: board,
      partner_availability: [],
      partner_absence: [
        { partner_profile_id: "p2", starts_on: "2026-10-12", ends_on: "2026-10-12" },
      ],
    });
    await expect(assertBoardAvailable(away, "b1", "2026-10-12T07:00:00Z")).rejects.toThrow(
      "Partner To er ikke ledig",
    );
  });

  it("tjekker 60 minutter: et møde der stikker ud over vinduet afvises", async () => {
    // 11:30-12:30 dansk
    await expect(assertBoardAvailable(service, "b1", "2026-10-12T09:30:00Z")).rejects.toThrow(
      "Partner Én",
    );
  });

  it("afviser et ugyldigt tidspunkt", async () => {
    await expect(assertBoardAvailable(service, "b1", "nonsens")).rejects.toThrow("Ugyldigt");
  });

  it("kaster ved læsefejl frem for at svare 'ledig'", async () => {
    const broken = fakeService({
      board_partner: board,
      partner_availability: { error: "boom" },
      partner_absence: [],
    });
    await expect(assertBoardAvailable(broken, "b1", "2026-10-12T07:00:00Z")).rejects.toThrow(
      "Kunne ikke læse tilgængelighed",
    );
  });

  it("et board uden partnere giver ingen at afvise", async () => {
    const empty = fakeService({ board_partner: [] });
    await expect(
      assertBoardAvailable(empty, "b1", "2026-10-12T07:00:00Z"),
    ).resolves.toBeUndefined();
  });
});

describe("assertMeetingBoardAvailable — flytning", () => {
  it("finder boardet via mødet og afviser", async () => {
    const service = fakeService({
      meeting: [{ board_id: "b1" }],
      board_partner: board,
      partner_availability: [MON_09_12],
      partner_absence: [],
    });
    await expect(
      assertMeetingBoardAvailable(service, "m1", "2026-10-12T12:00:00Z"),
    ).rejects.toThrow("Partner Én er ikke ledig");
  });

  it("ukendt møde → 'Møde ikke fundet.'", async () => {
    await expect(
      assertMeetingBoardAvailable(fakeService({ meeting: [] }), "m1", "2026-10-12T07:00:00Z"),
    ).rejects.toThrow("Møde ikke fundet.");
  });
});

describe("readBoardCalendars", () => {
  it("normaliserer embed-formerne og fordeler rækker pr. partner", async () => {
    const service = fakeService({
      board_partner: board,
      partner_availability: [MON_09_12],
      partner_absence: [
        { partner_profile_id: "p2", starts_on: "2026-10-12", ends_on: "2026-10-13" },
      ],
    });
    const calendars = await readBoardCalendars(service, "b1");
    expect(calendars.map((c) => c.name)).toEqual(["Partner Én", "Partner To"]);
    expect(calendars[0]?.calendar.slots).toEqual([
      { weekday: 1, startTime: "09:00:00", endTime: "12:00:00" },
    ]);
    expect(calendars[1]?.calendar.absences).toEqual([
      { startsOn: "2026-10-12", endsOn: "2026-10-13" },
    ]);
  });
});

describe("getBoardCommonWindows — ejerens bookingvisning", () => {
  const now = new Date("2026-10-12T05:00:00Z");

  it("kræver ejer-rollen", async () => {
    mocked.user = { id: "u1", email: "x@y", roles: ["partner"] };
    mocked.service = fakeService({ board: [{ id: "b1" }] });
    await expect(getBoardCommonWindows("b1", ENV, now)).rejects.toThrow();
  });

  it("fremmed board (ikke ejerens) giver null — ingen data lækkes", async () => {
    mocked.user = { id: "u1", email: "x@y", roles: ["ejer"] };
    mocked.service = fakeService({ board: [] });
    await expect(getBoardCommonWindows("b1", ENV, now)).resolves.toBeNull();
  });

  it("afleverer kun vinduer, flag og navne — ingen rækker eller noter", async () => {
    mocked.user = { id: "u1", email: "x@y", roles: ["ejer"] };
    mocked.service = fakeService({
      board: [{ id: "b1" }],
      board_partner: board,
      partner_availability: [MON_09_12],
      partner_absence: [
        {
          partner_profile_id: "p2",
          starts_on: "2026-12-01",
          ends_on: "2026-12-02",
          note: "hemmeligt",
        },
      ],
    });
    const view = await getBoardCommonWindows("b1", ENV, now);
    expect(view?.anyRestriction).toBe(true);
    expect(view?.restrictedNames).toEqual(["Partner Én", "Partner To"]);
    expect(view?.windows[0]).toEqual({
      start: "2026-10-12T07:00:00.000Z",
      end: "2026-10-12T10:00:00.000Z",
    });
    expect(JSON.stringify(view)).not.toContain("hemmeligt");
  });
});
