import { demoRef, demoRoomPath } from "../demo";
import type {
  BoardEventType,
  BoardEventTypeRequest,
  BookingProvider,
  MultiHostMeetingRequest,
  ScheduledMeeting,
} from "./port";

/**
 * Åbenlyst falsk event type-id til demo (ADR 0041): ikke et id Cal.com kan have udstedt. Gemmes
 * ALDRIG i `board.calcom_event_type_id` — et demo-id i databasen ville ellers blive sendt til en
 * rigtig Cal.com den dag nøglerne lander.
 */
export const DEMO_EVENT_TYPE_ID = 2_147_000_000;

/**
 * Demo (ADR 0041): en booking der virker uden Cal.com. Bekræfter det ønskede tidspunkt
 * uændret og peger "Deltag" på appens eget demo-møderum, så linket lander et sted.
 *
 * Det den bevidst IKKE gør: tjekke kalendere. Det er netop Cal.coms leverance, og demoen
 * foregiver ikke at have den — multi-host-verifikationen står stadig i
 * docs/spikes/multi-host.md.
 */
export class DemoBookingProvider implements BookingProvider {
  readonly name = "demo";

  /** Intet event type findes hos en leverandør der ikke findes — returnerer det falske demo-id. */
  async upsertBoardEventType(_req: BoardEventTypeRequest): Promise<BoardEventType> {
    return { eventTypeId: DEMO_EVENT_TYPE_ID };
  }

  async createMultiHostMeeting(req: MultiHostMeetingRequest): Promise<ScheduledMeeting> {
    const uid = demoRef("booking");
    return { id: uid, uid, startsAt: req.start, joinUrl: demoRoomPath(uid) };
  }

  async rescheduleMeeting(uid: string, startsAt: string): Promise<ScheduledMeeting> {
    return { id: uid, uid, startsAt, joinUrl: demoRoomPath(uid) };
  }

  async cancelMeeting(_uid: string, _reason?: string): Promise<void> {
    // Intet at aflyse hos en leverandør der ikke findes — Supabase er sandhedskilden.
  }

  /** Demoen holder ingen tilstand på leverandørsiden; reconciliation har intet at hente. */
  async getMeeting(_uid: string): Promise<ScheduledMeeting | null> {
    return null;
  }
}
