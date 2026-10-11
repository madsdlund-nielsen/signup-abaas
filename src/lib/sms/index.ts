import { isDemoMode, isEnabled } from "@/server/flags";
import { DemoSmsSender } from "./demo";
import { InMobileSmsSender } from "./inmobile";
import type { SmsMessage, SmsReceipt, SmsSender } from "./port";

export type { SmsMessage, SmsReceipt, SmsSender } from "./port";

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

/**
 * Stub: virker uden nøgler — logger i stedet for at sende. Logger ALDRIG modtager eller tekst:
 * nummeret er persondata, og teksten kan bære et auth-frit rating-link (ADR 0057/0060).
 */
class StubSmsSender implements SmsSender {
  readonly name = "stub";
  async send(message: SmsMessage): Promise<SmsReceipt> {
    console.info(`[sms:stub] ville sende én SMS (${message.message.length} tegn)`);
    return { reference: null };
  }
}

export function createSmsSender(env: Record<string, string | undefined> = process.env): SmsSender {
  const config = readConfig(env);
  if (isEnabled("sms", env) && config.apiKey && config.sender) {
    return new InMobileSmsSender({ apiKey: config.apiKey, sender: config.sender });
  }
  // Demo (ADR 0041): kun når rigtig config mangler — rigtige nøgler vinder altid.
  if (isDemoMode(env) && !isConfigured(config)) return new DemoSmsSender();
  return new StubSmsSender();
}
