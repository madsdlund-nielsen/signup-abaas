import { isDemoMode, isEnabled } from "@/server/flags";
import { NotConfiguredError } from "../errors";
import { CalComBookingProvider } from "./calcom";
import { DemoBookingProvider } from "./demo";
import type {
  BoardEventType,
  BoardEventTypeRequest,
  BookingProvider,
  MultiHostMeetingRequest,
  ScheduledMeeting,
} from "./port";

export type {
  BoardEventType,
  BoardEventTypeRequest,
  BookingAttendee,
  BookingProvider,
  MultiHostMeetingRequest,
  ScheduledMeeting,
} from "./port";
export { DEMO_EVENT_TYPE_ID } from "./demo";

interface BookingConfig {
  apiKey: string | undefined;
  teamId: string | undefined;
  apiUrl: string;
}

function readConfig(env: Record<string, string | undefined>): BookingConfig {
  return {
    apiKey: env.CALCOM_API_KEY,
    // Event type-id'et er IKKE længere konfiguration: det er ét collective event type pr. board og
    // lever som `board.calcom_event_type_id` (migration 0019, ADR 0046). Team-id'et er kontoens.
    teamId: env.CALCOM_TEAM_ID,
    // EU-residens: URL'en er udskiftelig (cal.eu / self-host) — plan-valg er STOP-gate (spike-doc).
    apiUrl: env.CALCOM_API_URL ?? "https://api.cal.com/v2",
  };
}

function isConfigured(c: BookingConfig): boolean {
  return Boolean(c.apiKey);
}

/** Team-id som heltal, eller null (ikke sat/ugyldigt → upsertBoardEventType fejler højlydt). */
function parseTeamId(raw: string | undefined): number | null {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}

/** Stub: kaster NotConfiguredError — synligt hul indtil flag + nøgler er sat (stub-politik). */
class StubBookingProvider implements BookingProvider {
  readonly name = "stub";
  async upsertBoardEventType(_req: BoardEventTypeRequest): Promise<BoardEventType> {
    throw new NotConfiguredError("cal.com", "upsertBoardEventType");
  }
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
      teamId: parseTeamId(config.teamId),
      apiUrl: config.apiUrl,
    });
  }
  // Demo (ADR 0041): kun når rigtig config mangler — rigtige nøgler vinder altid.
  if (isDemoMode(env) && !isConfigured(config)) return new DemoBookingProvider();
  return new StubBookingProvider();
}
