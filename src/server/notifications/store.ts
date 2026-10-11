/**
 * Datalaget bag notifikationsmotoren (ADR 0057). Motoren (`./engine`) taler kun med dette
 * interface, så dens regler — idempotens, retry, hvad der er en fejl — kan testes uden
 * Supabase; den ene konkrete implementering her er ren Supabase-limning (service-role, som
 * resten af `src/server/*`-writes) og dækkes af db-testene for skemaet (0021) og af
 * integrationstestene for motoren mod en in-memory-implementering.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { NotificationChannelKey } from "./catalog";

export type DeliveryStatus = "afventer" | "sendt" | "fejlet" | "stub" | "demo";

/** En live skabelon, som motoren ser den. */
export interface LiveTemplate {
  id: string;
  version: number;
  channel: NotificationChannelKey;
  subject: string | null;
  body: string;
}

export interface ClaimInput {
  typeKey: string;
  channel: NotificationChannelKey;
  recipientUserId: string;
  relatedId: string | null;
  idempotencyKey: string;
  now: Date;
}

export type ClaimResult =
  | { claimed: true; deliveryId: string }
  /** Nøglen findes og er endelig (sendt/stub/demo/fejlet-efter-forsøg/afventer) — send ikke. */
  | { claimed: false; existingStatus: DeliveryStatus };

export interface DeliveryPatch {
  status: DeliveryStatus;
  attempt?: number;
  error?: string | null;
  providerRef?: string | null;
  templateId?: string | null;
}

/** Modtagerens adresse på en kanal, eller hvorfor den ikke findes. */
export type RecipientAddress = { address: string } | { address: null; reason: string };

export interface NotificationStore {
  findLiveTemplate(typeKey: string, channel: NotificationChannelKey): Promise<LiveTemplate | null>;
  /**
   * Reservér udsendelsen. Den unikke idempotensnøgle ER låsen: kun én kalder får `claimed`.
   * En række der aldrig nåede ud på ledningen (`fejlet` med 0 forsøg — fx fordi skabelonen
   * manglede dengang) og et forladt claim (`afventer` med 0 forsøg, ældre end
   * `STALE_CLAIM_MS`) kan overtages; alt andet er endeligt.
   */
  claimDelivery(input: ClaimInput): Promise<ClaimResult>;
  /** Opdatér rækken — både undervejs (forsøgstælleren) og når udfaldet er kendt. */
  updateDelivery(deliveryId: string, patch: DeliveryPatch): Promise<void>;
  /**
   * Slå modtagerens adresse op. Adressen forlader aldrig dette kald — den logges ikke. SMS kræver
   * BÅDE et nummer og et registreret SMS-samtykke (`app_user.sms_opt_in`, ADR 0061); mangler
   * en af delene, er svaret en begrundelse frem for en adresse.
   */
  resolveRecipient(userId: string, channel: NotificationChannelKey): Promise<RecipientAddress>;
  /** Modtagerens navn (kontoens `display_name`), eller null hvis vedkommende ikke har angivet et. */
  resolveRecipientName(userId: string): Promise<string | null>;
}

/** Et claim uden forsøg ældre end dette regnes som forladt (kørslen døde før afsendelsen). */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

/** Loggen når en SMS ikke kan sendes fordi nummer eller samtykke mangler (ingen persondata). */
export const NO_SMS_CONSENT_REASON = "intet SMS-samtykke/telefonnummer";

/** Postgres' kode for brud på en unik constraint. */
const UNIQUE_VIOLATION = "23505";

export function createSupabaseNotificationStore(service: SupabaseClient): NotificationStore {
  return {
    async findLiveTemplate(typeKey, channel) {
      const { data, error } = await service
        .from("notification_template")
        .select("id, version, channel, subject, body")
        .eq("type_key", typeKey)
        .eq("channel", channel)
        .eq("status", "live")
        .maybeSingle();
      if (error) throw new Error(`Kunne ikke læse skabelonen: ${error.message}`);
      return (data as LiveTemplate | null) ?? null;
    },

    async claimDelivery(input) {
      const now = input.now.toISOString();
      const { data, error } = await service
        .from("notification_delivery")
        .insert({
          type_key: input.typeKey,
          channel: input.channel,
          recipient_user_id: input.recipientUserId,
          related_id: input.relatedId,
          idempotency_key: input.idempotencyKey,
          status: "afventer",
          attempt: 0,
          created_at: now,
          updated_at: now,
        })
        .select("id")
        .single();
      if (!error && data) return { claimed: true, deliveryId: (data as { id: string }).id };
      if (error?.code !== UNIQUE_VIOLATION) {
        throw new Error(`Kunne ikke reservere udsendelsen: ${error?.message ?? "ingen række"}`);
      }

      const { data: existing, error: readError } = await service
        .from("notification_delivery")
        .select("id, status, attempt, updated_at")
        .eq("idempotency_key", input.idempotencyKey)
        .single();
      if (readError || !existing) {
        throw new Error(`Kunne ikke læse den eksisterende udsendelse: ${readError?.message ?? "ingen række"}`);
      }
      const row = existing as { id: string; status: DeliveryStatus; attempt: number; updated_at: string };

      // Overtagelse er en compare-and-set på præcis den tilstand vi læste: vinder to kørsler
      // racet om samme række, får kun den ene en række tilbage.
      const takeOver = async (match: { status: DeliveryStatus; updated_at?: string }) => {
        let query = service
          .from("notification_delivery")
          .update({ status: "afventer", error: null, updated_at: now })
          .eq("id", row.id)
          .eq("status", match.status)
          .eq("attempt", 0);
        if (match.updated_at) query = query.eq("updated_at", match.updated_at);
        const { data: taken } = await query.select("id");
        return Boolean(taken && taken.length > 0);
      };

      if (row.status === "fejlet" && row.attempt === 0 && (await takeOver({ status: "fejlet" }))) {
        return { claimed: true, deliveryId: row.id };
      }
      const age = input.now.getTime() - new Date(row.updated_at).getTime();
      if (
        row.status === "afventer" &&
        row.attempt === 0 &&
        age > STALE_CLAIM_MS &&
        (await takeOver({ status: "afventer", updated_at: row.updated_at }))
      ) {
        return { claimed: true, deliveryId: row.id };
      }
      return { claimed: false, existingStatus: row.status };
    },

    async updateDelivery(deliveryId, patch) {
      const { error } = await service
        .from("notification_delivery")
        .update({
          status: patch.status,
          ...(patch.attempt !== undefined ? { attempt: patch.attempt } : {}),
          ...(patch.error !== undefined ? { error: patch.error } : {}),
          ...(patch.providerRef !== undefined ? { provider_ref: patch.providerRef } : {}),
          ...(patch.templateId !== undefined ? { template_id: patch.templateId } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", deliveryId);
      if (error) throw new Error(`Kunne ikke opdatere udsendelsen: ${error.message}`);
    },

    async resolveRecipient(userId, channel) {
      if (channel === "sms") {
        const { data, error } = await service
          .from("app_user")
          .select("phone_e164, sms_opt_in")
          .eq("id", userId)
          .maybeSingle();
        if (error) throw new Error(`Kunne ikke læse modtageren: ${error.message}`);
        const row = data as { phone_e164: string | null; sms_opt_in: boolean | null } | null;
        // Begge dele: et nummer uden samtykke (gemt, men ikke givet til SMS) bruges ikke.
        if (!row?.sms_opt_in || !row.phone_e164) return { address: null, reason: NO_SMS_CONSENT_REASON };
        return { address: row.phone_e164 };
      }
      const { data, error } = await service
        .from("app_user")
        .select("email")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error(`Kunne ikke læse modtageren: ${error.message}`);
      const email = (data as { email: string | null } | null)?.email;
      return email ? { address: email } : { address: null, reason: "modtageren har ingen e-mailadresse" };
    },

    async resolveRecipientName(userId) {
      const { data, error } = await service
        .from("app_user")
        .select("display_name")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error(`Kunne ikke læse modtageren: ${error.message}`);
      const name = (data as { display_name: string | null } | null)?.display_name?.trim();
      return name ? name : null;
    },
  };
}
