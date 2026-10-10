/**
 * inMobile-adapter (fase 4.5, ADR 0057). Rå fetch, ingen SDK.
 *
 * ⚠ BYGGET MOD BEDSTE FORSTÅELSE AF API v4 — ALDRIG KØRT MOD EN KONTO. Formen nedenfor er
 * hentet fra hukommelsen af inMobiles dokumentation, ikke fra en spec vi har kunnet
 * verificere (Alunta-adapteren er skrevet mod en OpenAPI-fil; her findes ingen). Tre ting skal
 * bekræftes mod en rigtig konto/dokumentationen, før FLAG_SMS tændes:
 *   1. endpointet: `POST https://api.inmobile.com/v4/sms/outgoing`
 *   2. auth: HTTP Basic med API-nøglen som adgangskode (brugernavn tomt)
 *   3. kroppen: `{ messages: [{ to, text, from, messageId }] }`, og at `to` er landekode uden `+`
 * TODO(mads): verificér mod inMobile live (konto + test-SMS), og ret adapteren hvis formen afviger.
 *
 * Fejlmodellen er den samme som Resend-adapterens: forbigående fejl (netværk, 429, 5xx) er
 * `retryable`; en afvisning (4xx) er endelig.
 */

import { ProviderError, isRetryableStatus } from "../errors";
import type { SmsMessage, SmsReceipt, SmsSender } from "./port";

// TODO(mads): verificér mod inMobile live — endpoint.
export const INMOBILE_ENDPOINT = "https://api.inmobile.com/v4/sms/outgoing";

export interface InMobileConfig {
  apiKey: string;
  /** Afsendernavn (alfanumerisk) eller -nummer. */
  sender: string;
}

/** `+4512345678` → `4512345678`. inMobile tager landekode uden plus. */
export function toInMobileNumber(e164: string): string {
  return e164.trim().replace(/^\+/, "").replace(/^00/, "");
}

/** Ren request-bygger (unit-testbar). TODO(mads): verificér mod inMobile live — feltnavne. */
export function buildInMobileBody(config: Pick<InMobileConfig, "sender">, message: SmsMessage) {
  return {
    messages: [
      {
        to: toInMobileNumber(message.to),
        text: message.message,
        from: config.sender,
        // Vores egen reference — kommer tilbage i leverandørens leveringsrapporter.
        ...(message.idempotencyKey ? { messageId: message.idempotencyKey.slice(0, 50) } : {}),
      },
    ],
  };
}

/** HTTP Basic med nøglen som adgangskode. TODO(mads): verificér mod inMobile live — auth. */
export function inMobileAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`;
}

export class InMobileSmsSender implements SmsSender {
  readonly name = "inmobile";

  constructor(private readonly config: InMobileConfig) {}

  async send(message: SmsMessage): Promise<SmsReceipt> {
    let response: Response;
    try {
      response = await fetch(INMOBILE_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: inMobileAuthHeader(this.config.apiKey),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(buildInMobileBody(this.config, message)),
      });
    } catch {
      throw new ProviderError("inMobile", "send", null, "", true);
    }

    if (!response.ok) {
      throw new ProviderError(
        "inMobile",
        "send",
        response.status,
        await response.text().catch(() => ""),
        isRetryableStatus(response.status),
      );
    }

    // Svarformen er ikke verificeret (se øverst) — vi læser kun et besked-id hvis det er der,
    // og falder ellers tilbage til vores egen reference. Aldrig en fejl af et uventet svar.
    const payload = (await response.json().catch(() => null)) as {
      results?: Array<{ messageId?: unknown }>;
    } | null;
    const returned = payload?.results?.[0]?.messageId;
    return {
      reference:
        typeof returned === "string"
          ? returned
          : (message.idempotencyKey?.slice(0, 50) ?? null),
    };
  }
}
