import { isEnabled } from "@/server/flags";
import { NotConfiguredError } from "../errors";
import { CalComBookingProvider } from "./calcom";
import type { BookingProvider, MultiHostMeetingRequest, ScheduledMeeting } from "./port";

export type { BookingProvider, MultiHostMeetingRequest, ScheduledMeeting } from "./port";

interface BookingConfig {
  apiKey: string | undefined;
  eventTypeId: string | undefined;
  apiUrl: string;
}

function readConfig(env: Record<string, string | undefined>): BookingConfig {
  return {
    apiKey: env.CALCOM_API_KEY,
    eventTypeId: env.CALCOM_EVENT_TYPE_ID,
    // EU-residens: URL'en er udskiftelig (cal.eu / self-host) — plan-valg er STOP-gate (spike-doc).
    apiUrl: env.CALCOM_API_URL ?? "https://api.cal.com/v2",
  };
}

function isConfigured(c: BookingConfig): boolean {
  return Boolean(c.apiKey) && Number.isFinite(Number(c.eventTypeId));
}

/** Stub: kaster NotConfiguredError — synligt hul indtil flag + nøgler er sat (stub-politik). */
class StubBookingProvider implements BookingProvider {
  readonly name = "stub";
  async createMultiHostMeeting(_req: MultiHostMeetingRequest): Promise<ScheduledMeeting> {
    throw new NotConfiguredError("cal.com", "createMultiHostMeeting");
  }
  async rescheduleMeeting(_uid: string, _startsAt: string): Promise<ScheduledMeeting> {
    throw new NotConfiguredError("cal.com", "rescheduleMeeting");
  }
  async cancelMeeting(_uid: string, _reason?: string): Promise<void> {
    throw new NotConfiguredError("cal.com", "cancelMeeting");
  }
  async getMeeting(_uid: string): Promise<ScheduledMeeting | null> {
    throw new NotConfiguredError("cal.com", "getMeeting");
  }
}

export function createBookingProvider(env: Record<string, string | undefined> = process.env): BookingProvider {
  const config = readConfig(env);
  if (isEnabled("booking", env) && isConfigured(config)) {
    return new CalComBookingProvider({
      apiKey: config.apiKey as string,
      eventTypeId: Number(config.eventTypeId),
      apiUrl: config.apiUrl,
    });
  }
  return new StubBookingProvider();
}
