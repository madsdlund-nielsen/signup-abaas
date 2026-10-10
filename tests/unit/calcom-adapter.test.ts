import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBookingRequest,
  buildEventTypeRequest,
  CalComBookingProvider,
  CalComError,
} from "@/lib/booking/calcom";
import { DEMO_EVENT_TYPE_ID } from "@/lib/booking";
import { NotConfiguredError } from "@/lib/errors";
import { ownerAttendee, resolveEventTypeId, OWNER_TIME_ZONE } from "@/server/meetings/booking-info";

/**
 * Cal.com-adapterens request-mapping (ADR 0046, B-23) — mod den dokumenterede API v2-form:
 * bookinger bærer eventTypeId + start + ÉT attendee-objekt (intet hosts-felt); værterne bor på
 * team-event-typen. `fetch` mockes — intet netværk.
 */
const ATTENDEE = { name: "Ejer Ejersen", email: "ejer@example.com", timeZone: "Europe/Copenhagen" };

function mockFetch(body: unknown, init: { status?: number } = {}) {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

function lastCall(fn: ReturnType<typeof mockFetch>): { url: string; init: RequestInit; body: unknown } {
  const [url, init] = fn.mock.calls.at(-1) as unknown as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined };
}

const provider = (teamId: number | null = 55) =>
  new CalComBookingProvider({ apiKey: "k", teamId, apiUrl: "https://api.example/v2" });

afterEach(() => vi.unstubAllGlobals());

describe("buildBookingRequest", () => {
  it("sender eventTypeId, start, ét attendee-objekt og metadata — intet hosts-felt", () => {
    const body = buildBookingRequest({
      eventTypeId: 12,
      start: "2026-11-01T09:00:00Z",
      attendee: ATTENDEE,
      metadata: { abaasMeetingId: "m-1" },
    });
    expect(body).toEqual({
      eventTypeId: 12,
      start: "2026-11-01T09:00:00Z",
      attendee: ATTENDEE,
      metadata: { abaasMeetingId: "m-1" },
    });
    expect(body).not.toHaveProperty("hosts");
    expect(body).not.toHaveProperty("attendees");
    expect(Array.isArray(body.attendee)).toBe(false);
  });
});

describe("buildEventTypeRequest", () => {
  it("bygger et collective event type med partnernes Cal.com-bruger-id som hosts", () => {
    expect(
      buildEventTypeRequest({ title: "Board", slug: "abaas-board-1", lengthInMinutes: 60, hostUserIds: [3, 4] }),
    ).toEqual({
      title: "Board",
      slug: "abaas-board-1",
      lengthInMinutes: 60,
      schedulingType: "collective",
      hosts: [{ userId: 3 }, { userId: 4 }],
    });
  });
});

describe("CalComBookingProvider.createMultiHostMeeting", () => {
  it("POSTer til /bookings med bookings-versionen og mapper svaret", async () => {
    const fn = mockFetch({
      status: "success",
      data: { id: 9, uid: "uid-9", start: "2026-11-01T09:00:00.000Z", meetingUrl: "https://video/x" },
    });
    const scheduled = await provider().createMultiHostMeeting({
      eventTypeId: 12,
      start: "2026-11-01T09:00:00Z",
      attendee: ATTENDEE,
      metadata: {},
    });

    const { url, init, body } = lastCall(fn);
    expect(url).toBe("https://api.example/v2/bookings");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["cal-api-version"]).toBe("2024-08-13");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(body).toMatchObject({ eventTypeId: 12, attendee: ATTENDEE });
    expect(scheduled).toEqual({
      id: "9",
      uid: "uid-9",
      startsAt: "2026-11-01T09:00:00.000Z",
      joinUrl: "https://video/x",
    });
  });

  it("kaster CalComError ved HTTP-fejl", async () => {
    mockFetch({ error: "nope" }, { status: 400 });
    await expect(
      provider().createMultiHostMeeting({ eventTypeId: 1, start: "x", attendee: ATTENDEE, metadata: {} }),
    ).rejects.toBeInstanceOf(CalComError);
  });
});

describe("CalComBookingProvider.upsertBoardEventType", () => {
  it("opretter via POST /teams/{teamId}/event-types og returnerer id'et", async () => {
    const fn = mockFetch({ status: "success", data: { id: 321 } });
    const result = await provider(55).upsertBoardEventType({
      title: "Board",
      slug: "abaas-board-1",
      lengthInMinutes: 60,
      hostUserIds: [3, 4],
    });
    const { url, init, body } = lastCall(fn);
    expect(url).toBe("https://api.example/v2/teams/55/event-types");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["cal-api-version"]).toBe("2024-06-14");
    expect(body).toMatchObject({ schedulingType: "collective", hosts: [{ userId: 3 }, { userId: 4 }] });
    expect(result).toEqual({ eventTypeId: 321 });
  });

  it("opdaterer et eksisterende event type via PATCH og beholder id'et", async () => {
    const fn = mockFetch({ status: "success", data: {} });
    const result = await provider(55).upsertBoardEventType({
      eventTypeId: 321,
      title: "Board",
      slug: "abaas-board-1",
      lengthInMinutes: 60,
      hostUserIds: [3],
    });
    const { url, init } = lastCall(fn);
    expect(url).toBe("https://api.example/v2/teams/55/event-types/321");
    expect(init.method).toBe("PATCH");
    expect(result).toEqual({ eventTypeId: 321 });
  });

  it("fejler højlydt uden CALCOM_TEAM_ID — og uden hosts", async () => {
    const fn = mockFetch({});
    await expect(
      provider(null).upsertBoardEventType({ title: "B", slug: "b", lengthInMinutes: 60, hostUserIds: [1] }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(
      provider(55).upsertBoardEventType({ title: "B", slug: "b", lengthInMinutes: 60, hostUserIds: [] }),
    ).rejects.toThrow(/mindst én vært/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("opretter ikke stille et nyt event type når et slettet id opdateres (404)", async () => {
    mockFetch({}, { status: 404 });
    await expect(
      provider(55).upsertBoardEventType({
        eventTypeId: 321,
        title: "B",
        slug: "b",
        lengthInMinutes: 60,
        hostUserIds: [1],
      }),
    ).rejects.toBeInstanceOf(CalComError);
  });

  it("afviser en uventet svarform ved oprettelse", async () => {
    mockFetch({ status: "success", data: {} });
    await expect(
      provider(55).upsertBoardEventType({ title: "B", slug: "b", lengthInMinutes: 60, hostUserIds: [1] }),
    ).rejects.toBeInstanceOf(CalComError);
  });
});

describe("booking-info (server)", () => {
  it("ejeren er attendee med e-mail som navn og en eksplicit tidszone", () => {
    expect(ownerAttendee("ejer@example.com")).toEqual({
      name: "ejer@example.com",
      email: "ejer@example.com",
      timeZone: OWNER_TIME_ZONE,
    });
  });

  it("resolveEventTypeId: gemt id vinder uanset provider", () => {
    expect(resolveEventTypeId({ name: "calcom" }, 42)).toBe(42);
    expect(resolveEventTypeId({ name: "demo" }, 42)).toBe(42);
  });

  it("resolveEventTypeId: manglende id fejler højlydt i rigtig tilstand", () => {
    expect(() => resolveEventTypeId({ name: "calcom" }, null)).toThrow(/intet Cal\.com event type/);
  });

  it("resolveEventTypeId: demo fortsætter med det falske id, stub svarer ærligt", () => {
    expect(resolveEventTypeId({ name: "demo" }, null)).toBe(DEMO_EVENT_TYPE_ID);
    expect(() => resolveEventTypeId({ name: "stub" }, null)).toThrow(NotConfiguredError);
  });
});
