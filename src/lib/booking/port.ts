export interface MultiHostMeetingRequest {
  ownerUserId: string;
  /** 2-3 partnere på boardet (auth-bruger-id'er — kobles fra kataloget via app_user_id, ADR 0025). */
  partnerUserIds: string[];
  /** ISO 8601-starttidspunkt. */
  startsAt: string;
  /** Møde 60 min + 15 min betalt forberedelse håndteres i domænet. */
  durationMinutes: number;
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
 * Booking/scheduling. Leverandør: Cal.com (Platform managed users + Atoms).
 * TODO(mads): multi-host-liveverifikation når nøgler lander — 2-3 værter + ejer,
 * EU-residens på valgt niveau, og native mødeoptagelse på valgt plan. Byggegaten er
 * fjernet (2026-08-04); STOP ved plan-/tier-valg består. Se docs/spikes/multi-host.md.
 */
export interface BookingProvider {
  readonly name: string;
  createMultiHostMeeting(req: MultiHostMeetingRequest): Promise<ScheduledMeeting>;
  /** Flyt en eksisterende booking (leverandør-uid) til nyt starttidspunkt. */
  rescheduleMeeting(uid: string, startsAt: string): Promise<ScheduledMeeting>;
  /** Aflys en booking hos leverandøren. Idempotent hos Cal.com (allerede aflyst → ok). */
  cancelMeeting(uid: string, reason?: string): Promise<void>;
  /** Hent en booking (til reconciliation/fejlsøgning). Null hvis ukendt uid. */
  getMeeting(uid: string): Promise<ScheduledMeeting | null>;
}
