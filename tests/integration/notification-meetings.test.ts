import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getNotificationType } from "@/server/notifications/catalog";
import {
  meetingVariables,
  meetingChangeDiscriminator,
  notifyMeetingChanged,
  notifyPaymentFailed,
  ratingWindow,
  reminderWindow,
  scheduleMeetingChangedNotification,
  sendMeetingReminders,
  sendRatingRequests,
} from "@/server/notifications/meetings";
import { makeDeps } from "./support/notification-fakes";

/**
 * Mødenotifikationerne (fase 4.5, ADR 0057): hvem der får besked, hvilke møder der skylder en
 * planlagt besked, og at intet planlagt sendes før ejeren har fastsat tidspunktet.
 */
const OWNER = "00000000-0000-0000-0000-00000000000a";
const PARTNER_B = "00000000-0000-0000-0000-00000000000b";
const PARTNER_C = "00000000-0000-0000-0000-00000000000c";
const MEETING = "00000000-0000-0000-0000-0000000f0001";

interface FakeRow {
  id: string;
  starts_at: string;
  duration_minutes: number;
  status: string;
  board: { name: string; owner_id: string } | null;
  meeting_partner: Array<{ partner_profile: { app_user_id: string | null } | null }>;
}

function row(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: MEETING,
    starts_at: "2026-10-13T10:00:00Z",
    duration_minutes: 60,
    status: "planlagt",
    board: { name: "[DEMO] Testboard", owner_id: OWNER },
    meeting_partner: [
      { partner_profile: { app_user_id: PARTNER_B } },
      { partner_profile: { app_user_id: PARTNER_C } },
      { partner_profile: { app_user_id: null } }, // partner uden login kan ikke nås
    ],
    ...overrides,
  };
}

/** Minimal PostgREST-lignende kæde: husker kaldene, svarer med de givne rækker. */
function fakeService(rows: unknown[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gt", "gte", "lt", "lte"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
  const service = {
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { service, calls };
}

function untouchedService(): SupabaseClient {
  return new Proxy({}, {
    get() {
      throw new Error("Tjenesten må ikke røres når tidspunktet ikke er fastlagt");
    },
  }) as SupabaseClient;
}

function setup() {
  const ctx = makeDeps();
  for (const user of [OWNER, PARTNER_B, PARTNER_C]) {
    ctx.store.addresses.set(user, { email: `${user.slice(-1)}-test@example.invalid` });
  }
  ctx.store.setLive("email", "[DEMO] {{board_navn}} {{moede_tidspunkt}} {{link}} {{aendring}}", "[DEMO] emne", "meeting-changed");
  ctx.store.setLive("email", "[DEMO] {{board_navn}} {{moede_tidspunkt}} {{link}}", "[DEMO] emne", "meeting-reminder");
  ctx.store.setLive("email", "[DEMO] {{board_navn}} {{moede_tidspunkt}} {{link}}", "[DEMO] emne", "rating-request");
  ctx.store.setLive("email", "[DEMO] {{board_navn}} {{link}}", "[DEMO] emne", "payment-failed");
  return ctx;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("planlagte udsendelser sender intet før ejeren har fastsat tidspunktet", () => {
  it("kataloget har intet tidspunkt for påmindelse og ratinganmodning (TODO(ejer))", () => {
    expect(getNotificationType("meeting-reminder")?.schedule).toBeNull();
    expect(getNotificationType("rating-request")?.schedule).toBeNull();
  });

  it("sendMeetingReminders svarer 'ikke fastlagt' og rører hverken basen eller afsenderen", async () => {
    const { deps, email } = setup();
    const result = await sendMeetingReminders(new Date("2026-10-10T08:00:00Z"), untouchedService(), { deps });
    expect(result).toMatchObject({ status: "ikke-fastlagt" });
    expect(email.sent).toEqual([]);
  });

  it("sendRatingRequests svarer 'ikke fastlagt' og rører hverken basen eller afsenderen", async () => {
    const { deps, email } = setup();
    const result = await sendRatingRequests(new Date("2026-10-10T08:00:00Z"), untouchedService(), { deps });
    expect(result).toMatchObject({ status: "ikke-fastlagt" });
    expect(email.sent).toEqual([]);
  });
});

describe("sendMeetingReminders", () => {
  const NOW = new Date("2026-10-13T09:00:00Z");

  it("spørger efter planlagte møder der starter inden for vinduet", async () => {
    const { deps } = setup();
    const { service, calls } = fakeService([]);
    await sendMeetingReminders(NOW, service, { deps, schedule: { offsetMinutes: 120 } });

    expect(calls).toContainEqual(["from", "meeting"]);
    expect(calls).toContainEqual(["eq", "status", "planlagt"]);
    expect(calls).toContainEqual(["gt", "starts_at", "2026-10-13T09:00:00.000Z"]);
    expect(calls).toContainEqual(["lte", "starts_at", "2026-10-13T11:00:00.000Z"]);
  });

  it("reminderWindow er [nu, nu + offset]", () => {
    expect(reminderWindow(NOW, { offsetMinutes: 30 })).toEqual({
      from: "2026-10-13T09:00:00.000Z",
      to: "2026-10-13T09:30:00.000Z",
    });
  });

  it("sender til ejer og partnere med login — ikke til partnere uden", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
    const { deps, email } = setup();
    const { service } = fakeService([row()]);

    const result = await sendMeetingReminders(NOW, service, { deps, schedule: { offsetMinutes: 120 } });

    expect(result).toMatchObject({ status: "koert", meetings: 1 });
    // Tre modtagere × e-mail (SMS har ingen live skabelon → fejlet pr. modtager).
    expect(email.sent).toHaveLength(3);
    expect(email.sent.map((m) => m.to).sort()).toEqual(
      ["a-test@example.invalid", "b-test@example.invalid", "c-test@example.invalid"].sort(),
    );
    expect(email.sent[0]?.body).toContain("https://app.example.invalid/moeder/" + MEETING);
    expect(email.sent[0]?.body).toContain("tirsdag den 13. oktober 2026 kl. 12.00");
  });

  it("kan køres igen uden dobbelt påmindelse; en flyttet mødetid giver en ny", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
    const { deps, email } = setup();
    const opts = { deps, schedule: { offsetMinutes: 120 } };

    await sendMeetingReminders(NOW, fakeService([row()]).service, opts);
    await sendMeetingReminders(NOW, fakeService([row()]).service, opts);
    expect(email.sent).toHaveLength(3);

    await sendMeetingReminders(NOW, fakeService([row({ starts_at: "2026-10-13T10:30:00Z" })]).service, opts);
    expect(email.sent).toHaveLength(6);
  });
});

describe("sendRatingRequests", () => {
  const NOW = new Date("2026-10-14T12:00:00Z");
  const schedule = { offsetMinutes: 60, catchUpMinutes: 240 };

  it("ratingWindow: mødet skal være sluttet for mindst offset siden, men ikke længere end catch-up", () => {
    const { endedAfter, endedBefore } = ratingWindow(NOW, schedule);
    expect(endedBefore.toISOString()).toBe("2026-10-14T11:00:00.000Z");
    expect(endedAfter.toISOString()).toBe("2026-10-14T07:00:00.000Z");
  });

  it("sender for et møde i vinduet, men ikke for et der er for nyligt eller for gammelt", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
    const { deps, email } = setup();
    const inWindow = row({ id: "m-i-vinduet", status: "afholdt", starts_at: "2026-10-14T08:30:00Z" }); // slut 09:30
    const tooRecent = row({ id: "m-for-nyligt", status: "afholdt", starts_at: "2026-10-14T10:30:00Z" }); // slut 11:30
    const tooOld = row({ id: "m-for-gammelt", status: "afholdt", starts_at: "2026-10-14T05:00:00Z" }); // slut 06:00
    const { service, calls } = fakeService([inWindow, tooRecent, tooOld]);

    const result = await sendRatingRequests(NOW, service, { deps, schedule });

    expect(calls).toContainEqual(["eq", "status", "afholdt"]);
    expect(result).toMatchObject({ status: "koert", meetings: 1 });
    expect(email.sent).toHaveLength(3); // ejer + to partnere med login
    expect(email.sent[0]?.body).toContain("/moeder/m-i-vinduet");
  });

  it("sender hver deltager højst én anmodning pr. møde", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
    const { deps, email } = setup();
    const meeting = row({ status: "afholdt", starts_at: "2026-10-14T08:30:00Z" });
    await sendRatingRequests(NOW, fakeService([meeting]).service, { deps, schedule });
    await sendRatingRequests(NOW, fakeService([meeting]).service, { deps, schedule });
    expect(email.sent).toHaveLength(3);
  });
});

describe("notifyMeetingChanged", () => {
  it("giver boardets partnere besked — ikke ejeren, som selv har foretaget ændringen", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
    const { deps, email } = setup();
    const { service } = fakeService([row({ status: "aflyst" })]);

    const summary = await notifyMeetingChanged(service, MEETING, "aflyst", "2026-10-10T08:00:00.000Z", deps);

    expect(summary.sendt).toBe(2);
    expect(email.sent.map((m) => m.to).sort()).toEqual(["b-test@example.invalid", "c-test@example.invalid"]);
    expect(email.sent[0]?.body).toContain("aflyst");
  });

  it("to ægte ændringer giver to beskeder; samme ændring to gange giver én", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
    const { deps, email } = setup();
    const { service } = fakeService([row()]);

    await notifyMeetingChanged(service, MEETING, "flyttet", "2026-10-10T08:00:00.000Z", deps);
    await notifyMeetingChanged(service, MEETING, "flyttet", "2026-10-10T08:00:00.000Z", deps);
    expect(email.sent).toHaveLength(2);
    await notifyMeetingChanged(service, MEETING, "flyttet", "2026-10-10T09:00:00.000Z", deps);
    expect(email.sent).toHaveLength(4);
  });

  it("kaster for et møde der ikke findes", async () => {
    const { deps } = setup();
    await expect(notifyMeetingChanged(fakeService([]).service, MEETING, "aflyst", "t", deps)).rejects.toThrow(
      /Mødet findes ikke/,
    );
  });

  it("uden appens URL fejler udsendelsen højlydt frem for at sende et tomt link", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const { deps, email, store } = setup();
    const summary = await notifyMeetingChanged(fakeService([row()]).service, MEETING, "aflyst", "t", deps);
    expect(summary.fejlet).toBe(2);
    expect(email.sent).toEqual([]);
    expect(store.deliveries[0]?.error).toMatch(/«link» har ingen værdi/);
  });
});

describe("scheduleMeetingChangedNotification — aldrig en fejlkilde for handlingen", () => {
  it("sluger og logger en fejl (skrubbet) i stedet for at kaste", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { service } = fakeService([]); // mødet findes ikke → notifyMeetingChanged kaster
    expect(() => scheduleMeetingChangedNotification(service, MEETING, "aflyst", "t")).not.toThrow();
    // Uden for en request kører opgaven inline; lad mikrotasks nå at færdiggøre.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(error).toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[0])).toContain("meeting-changed fejlede");
  });
});

describe("meetingVariables", () => {
  it("leverer præcis de variabler kataloget lover for mødetyperne", () => {
    const context = {
      meetingId: MEETING,
      boardName: "[DEMO] Testboard",
      startsAt: "2026-10-13T10:00:00Z",
      durationMinutes: 60,
      status: "planlagt",
      ownerUserId: OWNER,
      partnerUserIds: [],
    };
    const variables = meetingVariables(context, { aendring: "aflyst" }, { NEXT_PUBLIC_APP_URL: "https://app.example.invalid" });
    for (const key of ["meeting-reminder", "meeting-changed", "rating-request"]) {
      for (const variable of getNotificationType(key)!.variables) {
        // modtager_navn leveres af motoren pr. modtager (kontoens navn, ADR 0061), ikke af kalderen.
        if (variable.key === "modtager_navn") continue;
        expect(variables[variable.key], `${key}.${variable.key}`).toBeDefined();
      }
    }
  });
});

describe("notifyPaymentFailed — afsendelsen er bygget, koblingen ejes af betalingsskiven", () => {
  it("sender til boardets ejer med link til betalingssiden", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
    const { deps, email } = setup();
    const { service } = fakeService([{ id: "c1", membership: { board: { name: "[DEMO] Testboard", owner_id: OWNER } } }]);

    const outcomes = await notifyPaymentFailed(service, "c1", deps);

    expect(outcomes).toEqual([expect.objectContaining({ channel: "email", status: "sendt" })]);
    expect(email.sent[0]?.to).toBe("a-test@example.invalid");
    expect(email.sent[0]?.body).toContain("https://app.example.invalid/betaling");
  });
});

describe("meetingChangeDiscriminator — tilstandsbaseret nøgle, så et Cal.com-ekko ikke giver dobbeltbesked (B-40)", () => {
  it("aflysning har én fast nøgle", () => {
    expect(meetingChangeDiscriminator("aflyst")).toBe("endelig");
  });

  it("flytning nøgles på det normaliserede nye tidspunkt — samme instant, samme nøgle", () => {
    expect(meetingChangeDiscriminator("flyttet", "2026-11-02T10:00:00+01:00")).toBe("2026-11-02T09:00:00.000Z");
    expect(meetingChangeDiscriminator("flyttet", "2026-11-02T09:00:00.000Z")).toBe("2026-11-02T09:00:00.000Z");
  });

  it("flytning uden gyldigt tidspunkt kaster", () => {
    expect(() => meetingChangeDiscriminator("flyttet")).toThrow();
    expect(() => meetingChangeDiscriminator("flyttet", "ikke en dato")).toThrow();
  });
});
