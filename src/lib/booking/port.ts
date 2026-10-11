/** Ejerens kontaktoplysninger — Cal.com-attendee er ét objekt, ikke et bruger-id (ADR 0046). */
export interface BookingAttendee {
  name: string;
  email: string;
  /** IANA-tidszone, fx "Europe/Copenhagen". */
  timeZone: string;
}

/**
 * Book et møde mod boardets collective event type. Værterne (2-3 partnere) hører til event
 * typen, ikke til bookingen — de navngives derfor ikke her (ADR 0046, B-23).
 */
export interface MultiHostMeetingRequest {
  /** Boardets collective event type hos leverandøren (`board.calcom_event_type_id`, migration 0019). */
  eventTypeId: number;
  /** ISO 8601-starttidspunkt. Mødelængden (60 min; +15 min forberedelse i domænet) ligger på event typen. */
  start: string;
  attendee: BookingAttendee;
  /** Fri nøgle/værdi-metadata hos leverandøren (fx ABaaS' møde-/board-id til fejlsøgning). Kun strenge. */
  metadata: Record<string, string>;
}

/** Opret/opdatér boardets collective event type (ét pr. board). */
export interface BoardEventTypeRequest {
  /** Eksisterende event type hos leverandøren → opdatér hosts/titel. Null/udeladt → opret. */
  eventTypeId?: number | null;
  title: string;
  /** URL-venlig, unik slug hos leverandøren. */
  slug: string;
  /** Mødelængde i minutter (domænets 60 — afgøres af kalderen, ikke adapteren). */
  lengthInMinutes: number;
  /** Partnernes Cal.com-bruger-id'er (`partner_profile.calcom_user_id`, Teams-sæder). */
  hostUserIds: number[];
}

export interface BoardEventType {
  /** Leverandørens event type-id — gemmes i `board.calcom_event_type_id`. */
  eventTypeId: number;
}

export interface ScheduledMeeting {
  id: string;
  /** Leverandørens stabile booking-reference (Cal.com `uid`) — nøglen webhooks reconciles mod. */
  uid: string;
  /** ISO 8601 — leverandørens bekræftede starttid. */
  startsAt: string;
  /** Cal Video-link; genereres af bookingen (byggespec §5.5). */
  joinUrl: string;
}

/**
 * Booking/scheduling. Leverandør: Cal.com, **Teams-plan** (ADR 0046) — Platform-planen med
 * managed users + Atoms er deprecated og lukket for nye kunder. Multi-host = ét COLLECTIVE
 * event type pr. board (B-23): `upsertBoardEventType` opretter det, `createMultiHostMeeting`
 * booker mod det med ejeren som eneste attendee.
 *
 * TODO(mads): liveverifikation når nøgler lander — felt-kontrakten er bygget mod API v2's
 * dokumenterede form, men aldrig kørt mod en konto (L-1, L-3, L-10 i docs/spikes/multi-host.md).
 * EU-residens på Teams (L-7) og native mødeoptagelse (L-8) er begge uverificerede.
 */
export interface BookingProvider {
  readonly name: string;
  /** Opret (eller opdatér hosts på) boardets collective event type. Idempotent pr. `eventTypeId`. */
  upsertBoardEventType(req: BoardEventTypeRequest): Promise<BoardEventType>;
  createMultiHostMeeting(req: MultiHostMeetingRequest): Promise<ScheduledMeeting>;
  /** Flyt en eksisterende booking (leverandør-uid) til nyt starttidspunkt. */
  rescheduleMeeting(uid: string, startsAt: string): Promise<ScheduledMeeting>;
  /** Aflys en booking hos leverandøren. Idempotent hos Cal.com (allerede aflyst → ok). */
  cancelMeeting(uid: string, reason?: string): Promise<void>;
  /** Hent en booking (til reconciliation/fejlsøgning). Null hvis ukendt uid. */
  getMeeting(uid: string): Promise<ScheduledMeeting | null>;
}
