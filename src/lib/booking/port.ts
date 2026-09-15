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
 * Booking/scheduling. Leverandør: Cal.com, **Teams-plan** (ADR 0046) — Platform-planen med
 * managed users + Atoms er deprecated og lukket for nye kunder.
 *
 * ⚠ TODO(mads) — docs/backlog.md B-23: denne port modellerer værter PR. BOOKING, men API v2
 * har intet `hosts`-felt; værter hører til event typen. Multi-host skal bygges som ét
 * COLLECTIVE event type pr. board, og `ownerUserId` skal være ejerens kontaktoplysninger
 * ({ name, email, timeZone }), ikke et auth-id. Kontrakten nedenfor overlever ikke den rework.
 *
 * TODO(mads): resten af liveverifikationen når nøgler lander — EU-residens på Teams (L-7) og
 * native mødeoptagelse (L-8) er begge uverificerede. Se docs/spikes/multi-host.md.
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
