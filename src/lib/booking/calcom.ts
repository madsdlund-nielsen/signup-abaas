/**
 * Cal.com-adapter (API v2, REST) — Fase 2, den første ægte adapter bag en port (ADR 0004).
 * Ingen SDK-dependency: rå fetch mod API'et, mappet til domænetyper. Cal.com-typer må ALDRIG
 * lække ud af denne fil.
 *
 * Felt-kontrakten følger ADR 0046 (B-23): værter hører til EVENT TYPEN (ét collective team
 * event type pr. board), ikke til bookingen. `POST /bookings` får derfor kun
 * { eventTypeId, start, attendee: {name,email,timeZone}, metadata }.
 *
 * TODO(mads): kontofri kontrakt — kør mod en rigtig Teams-konto (docs/spikes/multi-host.md):
 *   - L-1: 2-3 værter + ejer på ét collective event
 *   - L-3: join-URL (meetingUrl vs. metadata.videoCallUrl)
 *   - L-10: team-event-type-endpointet (felter, `schedulingType`-værdi, svarform, version-header)
 *   - L-7: EU-residens — `apiUrl` kan afvige (cal.eu / self-host).
 */

import { NotConfiguredError } from "../errors";
import type {
  BoardEventType,
  BoardEventTypeRequest,
  BookingProvider,
  MultiHostMeetingRequest,
  ScheduledMeeting,
} from "./port";

/** `cal-api-version` for /bookings (den version bookings-endpointet er dokumenteret i). */
const BOOKINGS_API_VERSION = "2024-08-13";
/**
 * `cal-api-version` for event-types-endpoints.
 * TODO(mads): verificér live (L-10) — versionen er ikke angivet i ADR 0046/spike-dokumentet.
 */
const EVENT_TYPES_API_VERSION = "2024-06-14";

export interface CalComConfig {
  apiKey: string;
  /**
   * Teams-konto-id (`CALCOM_TEAM_ID`) — kun nødvendigt til at oprette/opdatere boardets
   * event type. Null: booking virker, men `upsertBoardEventType` fejler højlydt.
   */
  teamId: number | null;
  /** Default api.cal.com/v2; udskiftelig ift. EU-residens/self-host (exit-vejen, CLAUDE.md). */
  apiUrl: string;
}

interface CalBookingData {
  id?: number;
  uid?: string;
  start?: string;
  meetingUrl?: string;
  metadata?: { videoCallUrl?: string };
}

interface CalEventTypeData {
  id?: number;
}

/** POST /bookings-body (API v2) — ét attendee-objekt, intet hosts-felt (ADR 0046). */
export function buildBookingRequest(req: MultiHostMeetingRequest) {
  return {
    eventTypeId: req.eventTypeId,
    start: req.start,
    attendee: { name: req.attendee.name, email: req.attendee.email, timeZone: req.attendee.timeZone },
    metadata: req.metadata,
  };
}

/**
 * Body til boardets collective team event type: de felter ADR 0046 navngiver (`schedulingType`,
 * `hosts: [{userId}]`) + titel/slug/længde, som Cal.com kræver for at oprette et event type.
 * TODO(mads): verificér live (L-10) — `schedulingType`-værdien ("collective") og at
 * title/slug/lengthInMinutes er de rigtige feltnavne.
 */
export function buildEventTypeRequest(req: BoardEventTypeRequest) {
  return {
    title: req.title,
    slug: req.slug,
    lengthInMinutes: req.lengthInMinutes,
    schedulingType: "collective",
    hosts: req.hostUserIds.map((userId) => ({ userId })),
  };
}

export class CalComError extends Error {
  constructor(operation: string, status: number, body: string) {
    super(`Cal.com ${operation} fejlede (HTTP ${status}): ${body.slice(0, 300)}`);
    this.name = "CalComError";
  }
}

export class CalComBookingProvider implements BookingProvider {
  readonly name = "calcom";

  constructor(private readonly config: CalComConfig) {}

  private async request(
    operation: string,
    path: string,
    init?: RequestInit,
    apiVersion: string = BOOKINGS_API_VERSION,
  ): Promise<unknown> {
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        "cal-api-version": apiVersion,
        ...init?.headers,
      },
    });
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new CalComError(operation, response.status, await response.text());
    }
    return response.json();
  }

  private toScheduled(operation: string, payload: unknown): ScheduledMeeting {
    const data = ((payload as { data?: CalBookingData })?.data ?? {}) as CalBookingData;
    if (!data.uid || !data.start) {
      throw new CalComError(operation, 200, `uventet svarform: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return {
      id: String(data.id ?? data.uid),
      uid: data.uid,
      startsAt: data.start,
      joinUrl: data.meetingUrl ?? data.metadata?.videoCallUrl ?? "",
    };
  }

  async upsertBoardEventType(req: BoardEventTypeRequest): Promise<BoardEventType> {
    if (this.config.teamId == null) {
      throw new NotConfiguredError("cal.com", "upsertBoardEventType (CALCOM_TEAM_ID er ikke sat)");
    }
    if (req.hostUserIds.length === 0) {
      throw new Error("Et collective event type kræver mindst én vært (partner med Cal.com-bruger).");
    }
    const base = `/teams/${this.config.teamId}/event-types`;
    const existingId = req.eventTypeId ?? null;
    const payload = await this.request(
      "upsertBoardEventType",
      existingId != null ? `${base}/${existingId}` : base,
      { method: existingId != null ? "PATCH" : "POST", body: JSON.stringify(buildEventTypeRequest(req)) },
      EVENT_TYPES_API_VERSION,
    );
    // 404 ved opdatering (event typen er slettet hos Cal.com): fejl højlydt, opret ikke stille et nyt.
    if (payload == null) {
      throw new CalComError("upsertBoardEventType", 404, `event type ${existingId} findes ikke hos Cal.com`);
    }
    const data = (payload as { data?: CalEventTypeData }).data;
    const eventTypeId = data?.id ?? existingId;
    if (typeof eventTypeId !== "number" || !Number.isInteger(eventTypeId)) {
      throw new CalComError(
        "upsertBoardEventType",
        200,
        `uventet svarform: ${JSON.stringify(payload).slice(0, 200)}`,
      );
    }
    return { eventTypeId };
  }

  async createMultiHostMeeting(req: MultiHostMeetingRequest): Promise<ScheduledMeeting> {
    const payload = await this.request("createMultiHostMeeting", "/bookings", {
      method: "POST",
      body: JSON.stringify(buildBookingRequest(req)),
    });
    return this.toScheduled("createMultiHostMeeting", payload);
  }

  async rescheduleMeeting(uid: string, startsAt: string): Promise<ScheduledMeeting> {
    const payload = await this.request("rescheduleMeeting", `/bookings/${uid}/reschedule`, {
      method: "POST",
      body: JSON.stringify({ start: startsAt }),
    });
    return this.toScheduled("rescheduleMeeting", payload);
  }

  async cancelMeeting(uid: string, reason?: string): Promise<void> {
    await this.request("cancelMeeting", `/bookings/${uid}/cancel`, {
      method: "POST",
      body: JSON.stringify({ cancellationReason: reason ?? "Aflyst i appen" }),
    });
  }

  async getMeeting(uid: string): Promise<ScheduledMeeting | null> {
    const payload = await this.request("getMeeting", `/bookings/${uid}`, { method: "GET" });
    if (payload == null) return null;
    return this.toScheduled("getMeeting", payload);
  }
}
