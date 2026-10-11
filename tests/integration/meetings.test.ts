import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBookingProvider } from "@/lib/booking";
import { NotConfiguredError } from "@/lib/errors";
import { listMyMeetings } from "@/server/meetings";
import { getMyPartnerProfile } from "@/server/partners/portal";
import { POST } from "@/app/api/webhooks/calcom/route";

// Supabase-klienten mockes KUN for at kunne fremtvinge en fejlende mutation i
// webhook-handleren. Alt andet i filen rører den ikke (de øvrige tests når aldrig
// så langt, fordi de afvises på signatur/form først).
const mocked = vi.hoisted(() => ({ service: null as unknown }));
vi.mock("@/server/auth/supabase-server", () => ({
  createServiceSupabase: () => mocked.service,
  createServerSupabase: async () => mocked.service,
}));

// Notifikationen fra webhooken (B-40) fanges her; selve motoren testes i notification-*.test.ts.
const notified = vi.hoisted(() => [] as Array<{ meetingId: string; change: string; key: string }>);
vi.mock("@/server/notifications/meetings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/notifications/meetings")>();
  return {
    ...actual,
    scheduleMeetingChangedNotification: (_service: unknown, meetingId: string, change: string, key: string) => {
      notified.push({ meetingId, change, key });
    },
  };
});

describe("booking-port uden konfiguration (backend-stub — kaster, foregiver aldrig)", () => {
  const stub = createBookingProvider({});

  it("alle fem operationer kaster NotConfiguredError", async () => {
    await expect(
      stub.createMultiHostMeeting({
        eventTypeId: 7,
        start: "2026-09-01T10:00:00Z",
        attendee: { name: "Ejer", email: "ejer@example.com", timeZone: "Europe/Copenhagen" },
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(
      stub.upsertBoardEventType({ title: "Board", slug: "board", lengthInMinutes: 60, hostUserIds: [1] }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(stub.rescheduleMeeting("uid", "2026-09-02T10:00:00Z")).rejects.toBeInstanceOf(
      NotConfiguredError,
    );
    await expect(stub.cancelMeeting("uid")).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(stub.getMeeting("uid")).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("flag uden nøgler (og omvendt) giver stadig stub", async () => {
    await expect(
      createBookingProvider({ FLAG_BOOKING: "true" }).cancelMeeting("uid"),
    ).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(
      createBookingProvider({ CALCOM_API_KEY: "nøgle", CALCOM_TEAM_ID: "7" }).cancelMeeting("uid"),
    ).rejects.toBeInstanceOf(NotConfiguredError);
  });
});

describe("meetings-/portal-data-access uden Supabase-konfiguration (kontofri CI/dev)", () => {
  it("listMyMeetings returnerer []", async () => {
    await expect(listMyMeetings({})).resolves.toEqual([]);
  });

  it("getMyPartnerProfile returnerer null", async () => {
    await expect(getMyPartnerProfile({})).resolves.toBeNull();
  });
});

function post(body: string, signature?: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/webhooks/calcom", {
      method: "POST",
      body,
      headers: signature ? { "x-cal-signature-256": signature } : {},
    }),
  );
}

describe("webhook-endpointet (ADR 0027) — verifikation før alt andet", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("NEGATIV: uden CALCOM_WEBHOOK_SECRET behandles intet (503, aldrig fail-open)", async () => {
    vi.stubEnv("CALCOM_WEBHOOK_SECRET", "");
    const response = await post("{}");
    expect(response.status).toBe(503);
  });

  it("NEGATIV: ugyldig signatur afvises med 401 (secret sat, Supabase sat)", async () => {
    vi.stubEnv("CALCOM_WEBHOOK_SECRET", "s3cret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    const body = JSON.stringify({ triggerEvent: "BOOKING_CREATED" });
    expect((await post(body, "forkert")).status).toBe(401);
    expect((await post(body)).status).toBe(401);
  });

  it("verificeret men ukendt event-form kvitteres 200 uden behandling", async () => {
    vi.stubEnv("CALCOM_WEBHOOK_SECRET", "s3cret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    const body = JSON.stringify({ triggerEvent: "UKENDT_EVENT" });
    const signature = createHmac("sha256", "s3cret").update(body).digest("hex");
    const response = await post(body, signature);
    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/Ignoreret/);
  });
});

describe("webhook-idempotens må betyde 'præcis én gang', ikke 'højst én gang'", () => {
  afterEach(() => vi.unstubAllEnvs());

  /** Minimal Supabase-dobbelt: nok kæde til route-handlerens tre kald, og et kaldsspor. */
  function fakeService(updateError: string | null) {
    const calls: string[] = [];
    const service = {
      from(table: string) {
        return {
          insert: async () => {
            calls.push(`insert:${table}`);
            return { error: null };
          },
          update: () => ({
            eq: () => ({
              select: async () => {
                calls.push(`update:${table}`);
                return updateError
                  ? { data: null, error: { message: updateError, code: "XX000" } }
                  : { data: [{ id: "m1" }], error: null };
              },
            }),
          }),
          delete: () => ({
            eq: () => ({
              eq: async () => {
                calls.push(`delete:${table}`);
                return { error: null };
              },
            }),
          }),
        };
      },
    };
    return { service, calls };
  }

  function signedCancel() {
    const body = JSON.stringify({
      triggerEvent: "BOOKING_CANCELLED",
      createdAt: "2026-08-26T10:00:00Z",
      payload: { uid: "cal-uid-1" },
    });
    return { body, signature: createHmac("sha256", "s3cret").update(body).digest("hex") };
  }

  function configure() {
    vi.stubEnv("CALCOM_WEBHOOK_SECRET", "s3cret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  }

  it("fejler mutationen, rulles idempotensrækken tilbage så Cal.coms genlevering kan anvende eventet", async () => {
    configure();
    const { service, calls } = fakeService("db nede");
    mocked.service = service;

    const { body, signature } = signedCancel();
    const response = await post(body, signature);

    expect(response.status).toBe(500);
    // Uden rollbacken ville genleveringen ramme 23505 og kvittere 200 uden at anvende noget.
    expect(calls).toEqual(["insert:meeting_webhook_event", "update:meeting", "delete:meeting_webhook_event"]);
  });

  it("lykkes mutationen, står idempotensrækken (ingen rollback)", async () => {
    configure();
    const { service, calls } = fakeService(null);
    mocked.service = service;

    const { body, signature } = signedCancel();
    const response = await post(body, signature);

    expect(response.status).toBe(200);
    expect(calls).toEqual(["insert:meeting_webhook_event", "update:meeting"]);
  });

  it("aflysning i Cal.coms egen UI giver partnerne besked — med samme nøgle som appens aflysning (B-40)", async () => {
    configure();
    notified.length = 0;
    mocked.service = fakeService(null).service;

    const { body, signature } = signedCancel();
    expect((await post(body, signature)).status).toBe(200);
    // Nøglen er tilstandsbaseret: appens egen aflysning (som Cal.com ekkoer) giver samme nøgle,
    // så partnerne får én besked, ikke to.
    expect(notified).toEqual([{ meetingId: "m1", change: "aflyst", key: "endelig" }]);
  });

  it("flytning i Cal.com giver besked med det nye tidspunkt som nøgle; uden tidspunkt ingen besked", async () => {
    configure();
    notified.length = 0;
    mocked.service = fakeService(null).service;

    const sign = (payload: Record<string, unknown>) => {
      const body = JSON.stringify({ triggerEvent: "BOOKING_RESCHEDULED", createdAt: "2026-08-26T10:00:00Z", payload });
      return { body, signature: createHmac("sha256", "s3cret").update(body).digest("hex") };
    };
    const moved = sign({ uid: "cal-uid-2", rescheduleUid: "cal-uid-1", startTime: "2026-11-02T09:00:00+00:00" });
    expect((await post(moved.body, moved.signature)).status).toBe(200);
    expect(notified).toEqual([{ meetingId: "m1", change: "flyttet", key: "2026-11-02T09:00:00.000Z" }]);
  });
});
