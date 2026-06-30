import { isEnabled } from "@/server/flags";
import { NotConfiguredError } from "../errors";
import type { BookingProvider, MultiHostMeetingRequest, ScheduledMeeting } from "./port";

export type { BookingProvider, MultiHostMeetingRequest, ScheduledMeeting } from "./port";

interface BookingConfig {
  apiKey: string | undefined;
}

function readConfig(env: Record<string, string | undefined>): BookingConfig {
  return { apiKey: env.CALCOM_API_KEY };
}

function isConfigured(c: BookingConfig): boolean {
  return Boolean(c.apiKey);
}

/** Stub: kaster NotConfiguredError — multi-host-spike er ikke afsluttet. */
class StubBookingProvider implements BookingProvider {
  readonly name = "stub";
  async createMultiHostMeeting(_req: MultiHostMeetingRequest): Promise<ScheduledMeeting> {
    throw new NotConfiguredError("cal.com", "createMultiHostMeeting");
  }
}

// TODO: rigtig Cal.com-adapter efter multi-host-spike (Trin 9) og Mads' planvalg.
export function createBookingProvider(env: Record<string, string | undefined> = process.env): BookingProvider {
  const config = readConfig(env);
  if (isEnabled("booking", env) && isConfigured(config)) {
    // return new CalComBookingProvider(config);
  }
  return new StubBookingProvider();
}
