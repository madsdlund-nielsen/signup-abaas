import { isEnabled } from "@/server/flags";
import type { EmailMessage, EmailSender } from "./port";

export type { EmailMessage, EmailSender } from "./port";

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

/** Stub: virker uden nøgler — logger i stedet for at sende. */
class StubEmailSender implements EmailSender {
  readonly name = "stub";
  async send(message: EmailMessage): Promise<void> {
    console.info(`[email:stub] ville sende til ${message.to}: "${message.subject}"`);
  }
}

// TODO: rigtig ResendEmailSender (EU, Dublin) når RESEND_API_KEY lander.
export function createEmailSender(env: Record<string, string | undefined> = process.env): EmailSender {
  const config = readConfig(env);
  if (isEnabled("email", env) && isConfigured(config)) {
    // return new ResendEmailSender(config);
  }
  return new StubEmailSender();
}
