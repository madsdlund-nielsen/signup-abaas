import { vi } from "vitest";
import type { Analytics } from "@/lib/analytics";
import type { EmailMessage, EmailSender } from "@/lib/email";
import type { SmsMessage, SmsSender } from "@/lib/sms";
import type { NotificationChannelKey } from "@/server/notifications/catalog";
import type { EngineDeps } from "@/server/notifications/engine";
import {
  STALE_CLAIM_MS,
  type ClaimInput,
  type ClaimResult,
  type DeliveryPatch,
  type DeliveryStatus,
  type LiveTemplate,
  type NotificationStore,
  type RecipientAddress,
} from "@/server/notifications/store";

/**
 * Test-dobbeltgængere til notifikationsmotoren. In-memory-lageret spejler de regler
 * Supabase-lageret og skemaet (0021) håndhæver: unik idempotensnøgle, overtagelse af en række
 * der aldrig nåede ledningen (fejlet/afventer med 0 forsøg), og endelige statusser.
 * Alle adresser og tekster er åbenlyst syntetiske.
 */

export interface DeliveryRecord {
  id: string;
  typeKey: string;
  channel: NotificationChannelKey;
  recipientUserId: string;
  relatedId: string | null;
  idempotencyKey: string;
  status: DeliveryStatus;
  attempt: number;
  error: string | null;
  providerRef: string | null;
  templateId: string | null;
  updatedAt: Date;
}

export class MemoryStore implements NotificationStore {
  deliveries: DeliveryRecord[] = [];
  templates: LiveTemplate[] = [];
  /** userId → adresser pr. kanal. Mangler en kanal, har modtageren ingen adresse dér. */
  addresses = new Map<string, Partial<Record<NotificationChannelKey, string>>>();
  private nextId = 1;

  setLive(
    channel: NotificationChannelKey,
    body: string,
    subject: string | null = channel === "email" ? "[DEMO] Emne" : null,
    typeKey = "*",
  ): LiveTemplate {
    const template: LiveTemplate & { typeKey: string } = {
      id: `tpl-${this.nextId++}`,
      version: 1,
      channel,
      subject,
      body,
      typeKey,
    };
    this.templates.push(template);
    return template;
  }

  async findLiveTemplate(typeKey: string, channel: NotificationChannelKey) {
    const found = (this.templates as Array<LiveTemplate & { typeKey: string }>).find(
      (t) => t.channel === channel && (t.typeKey === "*" || t.typeKey === typeKey),
    );
    return found ?? null;
  }

  async claimDelivery(input: ClaimInput): Promise<ClaimResult> {
    const existing = this.deliveries.find((d) => d.idempotencyKey === input.idempotencyKey);
    if (!existing) {
      const record: DeliveryRecord = {
        id: `del-${this.nextId++}`,
        typeKey: input.typeKey,
        channel: input.channel,
        recipientUserId: input.recipientUserId,
        relatedId: input.relatedId,
        idempotencyKey: input.idempotencyKey,
        status: "afventer",
        attempt: 0,
        error: null,
        providerRef: null,
        templateId: null,
        updatedAt: input.now,
      };
      this.deliveries.push(record);
      return { claimed: true, deliveryId: record.id };
    }
    const stale = input.now.getTime() - existing.updatedAt.getTime() > STALE_CLAIM_MS;
    const neverOnTheWire =
      existing.attempt === 0 && (existing.status === "fejlet" || (existing.status === "afventer" && stale));
    if (neverOnTheWire) {
      existing.status = "afventer";
      existing.error = null;
      existing.updatedAt = input.now;
      return { claimed: true, deliveryId: existing.id };
    }
    return { claimed: false, existingStatus: existing.status };
  }

  async updateDelivery(deliveryId: string, patch: DeliveryPatch) {
    const record = this.deliveries.find((d) => d.id === deliveryId)!;
    record.status = patch.status;
    if (patch.attempt !== undefined) record.attempt = patch.attempt;
    if (patch.error !== undefined) record.error = patch.error;
    if (patch.providerRef !== undefined) record.providerRef = patch.providerRef;
    if (patch.templateId !== undefined) record.templateId = patch.templateId;
  }

  async resolveRecipient(userId: string, channel: NotificationChannelKey): Promise<RecipientAddress> {
    const address = this.addresses.get(userId)?.[channel];
    return address ? { address } : { address: null, reason: `ingen ${channel}-adresse (test)` };
  }
}

/** Afsender der kan scriptes: en kø af udfald (fejl kastes, andet er en kvittering). */
export class ScriptedSender<M extends EmailMessage | SmsMessage> {
  sent: M[] = [];
  outcomes: Array<Error | { reference: string | null }> = [];
  constructor(public name: string) {}

  async send(message: M) {
    this.sent.push(message);
    const next = this.outcomes.shift() ?? { reference: `${this.name.toUpperCase()}-REF-${this.sent.length}` };
    if (next instanceof Error) throw next;
    return next;
  }
}

export function makeDeps(overrides: Partial<{ emailName: string; smsName: string }> = {}) {
  const store = new MemoryStore();
  const email = new ScriptedSender<EmailMessage>(overrides.emailName ?? "resend");
  const sms = new ScriptedSender<SmsMessage>(overrides.smsName ?? "inmobile");
  const captured: Array<{ error: unknown; context?: Record<string, unknown> }> = [];
  const analytics: Analytics = {
    name: "test",
    capture: async () => undefined,
    captureException: async (error, context) => {
      captured.push({ error, context });
    },
  };
  const sleeps: number[] = [];
  const clock = { now: new Date("2026-10-10T08:00:00Z") };
  const deps: EngineDeps = {
    store,
    email: email as unknown as EmailSender,
    sms: sms as unknown as SmsSender,
    analytics,
    sleep: vi.fn(async (ms: number) => {
      sleeps.push(ms);
    }),
    now: () => clock.now,
  };
  return { deps, store, email, sms, captured, sleeps, clock };
}
