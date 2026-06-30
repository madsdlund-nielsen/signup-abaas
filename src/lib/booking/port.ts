export interface MultiHostMeetingRequest {
  ownerUserId: string;
  /** 2-3 partnere på boardet. */
  partnerUserIds: string[];
  /** ISO 8601-starttidspunkt. */
  startsAt: string;
  /** Møde 60 min + 15 min betalt forberedelse håndteres i domænet. */
  durationMinutes: number;
}

export interface ScheduledMeeting {
  id: string;
  joinUrl: string;
}

/**
 * Booking/scheduling. Leverandør: Cal.com (Platform managed users + Atoms).
 * TODO(mads): multi-host scheduling-spike — verificér 2-3 værter + ejer,
 * EU-residens på valgt niveau, og native mødeoptagelse på valgt plan.
 */
export interface BookingProvider {
  readonly name: string;
  createMultiHostMeeting(req: MultiHostMeetingRequest): Promise<ScheduledMeeting>;
}
