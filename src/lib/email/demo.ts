import { demoRef } from "../demo";
import type { EmailMessage, EmailSender, SendReceipt } from "./port";

/**
 * Demo (ADR 0041): "sender" ved at logge `[DEMO]` og kvittere med et åbenlyst falsk id, så
 * motoren, udsendelseslogget og admin-skærmene kan klikkes igennem før Resend-nøglen
 * lander. Intet forlader processen. Modtageradressen logges ikke — kun at en besked ville
 * være gået afsted.
 */
export class DemoEmailSender implements EmailSender {
  readonly name = "demo";

  async send(message: EmailMessage): Promise<SendReceipt> {
    console.info(`[email:demo] [DEMO] ville sende e-mail: "${message.subject}"`);
    return { reference: demoRef("msg") };
  }
}
