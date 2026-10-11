/**
 * Resend-adapter (fase 4.5, ADR 0057). Rå fetch, Bearer-auth, ingen SDK — samme mønster som
 * Alunta- og Cal.com-adapterne. Resend-typer lækker ikke ud af denne fil.
 *
 * Endpoint: `POST https://api.resend.com/emails` med `Authorization: Bearer <nøgle>` og
 * `{ from, to, subject, html, text }`; svaret er `{ "id": "…" }`.
 *
 * EU-RESIDENS (GDPR, docs/gdpr/leverandoer-register.md): regionen vælges IKKE i API-kaldet,
 * men på afsenderdomænet. Domænet skal oprettes i Resend med regionen `eu-west-1` (Irland/
 * Dublin) — i dashboardet under Domains → Add Domain → Region — FØR nøglen tages i brug.
 * API-nøglen er konto-global; et domæne oprettet i en anden region sender fra den region.
 * TODO(mads): bekræft at afsenderdomænet er i eu-west-1, og notér det i leverandør-registret.
 */

import { ProviderError, isRetryableStatus } from "../errors";
import type { EmailMessage, EmailSender, SendReceipt } from "./port";

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface ResendConfig {
  apiKey: string;
  /** Afsender, fx `Navn <adresse@domæne>` eller blot en adresse på det verificerede domæne. */
  fromAddress: string;
}

/** Ren request-bygger (unit-testbar): kroppen til POST /emails. */
export function buildResendBody(config: Pick<ResendConfig, "fromAddress">, message: EmailMessage) {
  return {
    from: config.fromAddress,
    to: [message.to],
    subject: message.subject,
    text: message.body,
    ...(message.html ? { html: message.html } : {}),
  };
}

export class ResendEmailSender implements EmailSender {
  readonly name = "resend";

  constructor(private readonly config: ResendConfig) {}

  async send(message: EmailMessage): Promise<SendReceipt> {
    let response: Response;
    try {
      response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          // Resend afviser et gentaget kald med samme nøgle (24 timer) — andet lag oven på
          // vores egen idempotens i notification_delivery.
          ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey.slice(0, 256) } : {}),
        },
        body: JSON.stringify(buildResendBody(this.config, message)),
      });
    } catch {
      // fetch kaster kun når forbindelsen aldrig gav et svar (DNS, timeout, afbrudt).
      throw new ProviderError("Resend", "send", null, "", true);
    }

    if (!response.ok) {
      throw new ProviderError(
        "Resend",
        "send",
        response.status,
        await response.text().catch(() => ""),
        isRetryableStatus(response.status),
      );
    }

    const payload = (await response.json().catch(() => null)) as { id?: unknown } | null;
    return { reference: typeof payload?.id === "string" ? payload.id : null };
  }
}
