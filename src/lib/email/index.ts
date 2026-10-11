import { isDemoMode, isEnabled } from "@/server/flags";
import { DemoEmailSender } from "./demo";
import type { EmailMessage, EmailSender, SendReceipt } from "./port";
import { ResendEmailSender } from "./resend";

export type { EmailMessage, EmailSender, SendReceipt } from "./port";

interface EmailConfig {
  apiKey: string | undefined;
  fromAddress: string | undefined;
}

function readConfig(env: Record<string, string | undefined>): EmailConfig {
  return { apiKey: env.RESEND_API_KEY, fromAddress: env.RESEND_FROM_ADDRESS };
}

function isConfigured(c: EmailConfig): boolean {
  return Boolean(c.apiKey && c.fromAddress);
}

/**
 * Stub: virker uden nøgler — logger i stedet for at sende. Logger ALDRIG modtager, emne eller
 * indhold: adressen er persondata, og indholdet kan bære et auth-frit rating-link (ADR 0057/0060).
 */
class StubEmailSender implements EmailSender {
  readonly name = "stub";
  async send(_message: EmailMessage): Promise<SendReceipt> {
    console.info("[email:stub] ville sende én e-mail");
    return { reference: null };
  }
}

export function createEmailSender(env: Record<string, string | undefined> = process.env): EmailSender {
  const config = readConfig(env);
  if (isEnabled("email", env) && config.apiKey && config.fromAddress) {
    return new ResendEmailSender({ apiKey: config.apiKey, fromAddress: config.fromAddress });
  }
  // Demo (ADR 0041): kun når rigtig config mangler — rigtige nøgler vinder altid.
  if (isDemoMode(env) && !isConfigured(config)) return new DemoEmailSender();
  return new StubEmailSender();
}
