import { demoRef } from "../demo";
import type { SmsMessage, SmsReceipt, SmsSender } from "./port";

/**
 * Demo (ADR 0041): "sender" ved at logge `[DEMO]` og kvittere med et åbenlyst falsk id.
 * Intet forlader processen. Hverken nummer eller beskedtekst logges — kun at en SMS ville
 * være gået afsted.
 */
export class DemoSmsSender implements SmsSender {
  readonly name = "demo";

  async send(_message: SmsMessage): Promise<SmsReceipt> {
    console.info("[sms:demo] [DEMO] ville sende SMS");
    return { reference: demoRef("msg") };
  }
}
