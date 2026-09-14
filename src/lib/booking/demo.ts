import { demoRef, demoRoomPath } from "../demo";
import type { BookingProvider, MultiHostMeetingRequest, ScheduledMeeting } from "./port";

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

  async createMultiHostMeeting(req: MultiHostMeetingRequest): Promise<ScheduledMeeting> {
    const uid = demoRef("booking");
    return { id: uid, uid, startsAt: req.startsAt, joinUrl: demoRoomPath(uid) };
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
