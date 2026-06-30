import { isEnabled } from "@/server/flags";
import type { SmsMessage, SmsSender } from "./port";

export type { SmsMessage, SmsSender } from "./port";

interface SmsConfig {
  apiKey: string | undefined;
  sender: string | undefined;
}

function readConfig(env: Record<string, string | undefined>): SmsConfig {
  return { apiKey: env.INMOBILE_API_KEY, sender: env.INMOBILE_SENDER };
}

function isConfigured(c: SmsConfig): boolean {
  return Boolean(c.apiKey && c.sender);
}

/** Stub: virker uden nøgler — logger i stedet for at sende. */
class StubSmsSender implements SmsSender {
  readonly name = "stub";
  async send(message: SmsMessage): Promise<void> {
    console.info(`[sms:stub] ville sende til ${message.to}: "${message.message}"`);
  }
}

// TODO: rigtig inMobile-adapter når INMOBILE_API_KEY lander.
export function createSmsSender(env: Record<string, string | undefined> = process.env): SmsSender {
  const config = readConfig(env);
  if (isEnabled("sms", env) && isConfigured(config)) {
    // return new InMobileSmsSender(config);
  }
  return new StubSmsSender();
}
