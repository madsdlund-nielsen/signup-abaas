/**
 * Cal.com-adapter (API v2, REST) — Fase 2, den første ægte adapter bag en port (ADR 0004).
 * Ingen SDK-dependency: rå fetch mod API'et, mappet til domænetyper. Cal.com-typer må ALDRIG
 * lække ud af denne fil.
 *
 * TODO(mads): multi-host-LIVEVERIFIKATION når nøgler lander (docs/spikes/multi-host.md):
 *   - 2-3 værter + ejer på ét event (hosts-tildeling pr. booking mod ét delt event type)
 *   - feltmapping for join-URL (meetingUrl vs. metadata.videoCallUrl) på den valgte plan
 *   - EU-residens: apiUrl kan afvige (cal.eu / self-host) — plan-/tier-valg er STOP-gate.
 */

import type { BookingProvider, MultiHostMeetingRequest, ScheduledMeeting } from "./port";

export interface CalComConfig {
  apiKey: string;
  /** Multi-host event type som bookinger oprettes mod (Cal.com-koncept — forbliver herinde). */
  eventTypeId: number;
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

export class CalComError extends Error {
  constructor(operation: string, status: number, body: string) {
    super(`Cal.com ${operation} fejlede (HTTP ${status}): ${body.slice(0, 300)}`);
    this.name = "CalComError";
  }
}

export class CalComBookingProvider implements BookingProvider {
  readonly name = "calcom";

  constructor(private readonly config: CalComConfig) {}

  private async request(operation: string, path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        "cal-api-version": "2024-08-13",
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

  async createMultiHostMeeting(req: MultiHostMeetingRequest): Promise<ScheduledMeeting> {
    const payload = await this.request("createMultiHostMeeting", "/bookings", {
      method: "POST",
      body: JSON.stringify({
        eventTypeId: this.config.eventTypeId,
        start: req.startsAt,
        lengthInMinutes: req.durationMinutes,
        attendees: [{ id: req.ownerUserId }],
        hosts: req.partnerUserIds.map((id) => ({ id })),
      }),
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
