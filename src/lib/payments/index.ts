import { isEnabled } from "@/server/flags";
import { NotConfiguredError } from "../errors";
import type { CardRegistration, ChargeRequest, CheckoutSession, PaymentProvider } from "./port";

export type {
  CardRegistration,
  ChargeRequest,
  CheckoutSession,
  PaymentFrequencyWeeks,
  PaymentProvider,
} from "./port";

interface PaymentConfig {
  aluntaApiKey: string | undefined;
  aluntaWebhookSecret: string | undefined;
}

// Alunta er besluttet (ADR 0023) — STRIPE_*/MOBILEPAY_* udgik med ADR 0029.
// MobilePay-understøttelse gennem Alunta er fortsat TODO(mads).
function readConfig(env: Record<string, string | undefined>): PaymentConfig {
  return {
    aluntaApiKey: env.ALUNTA_API_KEY,
    aluntaWebhookSecret: env.ALUNTA_WEBHOOK_SECRET,
  };
}

function isConfigured(c: PaymentConfig): boolean {
  return Boolean(c.aluntaApiKey);
}

/** Stub: kaster NotConfiguredError ved ægte backend-kald (intet kort/træk uden nøgler). */
class StubPaymentProvider implements PaymentProvider {
  readonly name = "stub";
  async registerCard(_reg: CardRegistration): Promise<CheckoutSession> {
    throw new NotConfiguredError("alunta", "registerCard");
  }
  async charge(_req: ChargeRequest): Promise<{ id: string }> {
    throw new NotConfiguredError("alunta", "charge");
  }
}

// TODO(mads): AluntaPaymentProvider er dataflow-afsøgningens leverance (ADR 0029, §12 pkt. 10).
// Aluntas API er uafsøgt — en gættet adapter ville bryde stub-politikken; derfor forbliver
// stubben aktiv selv med flag+nøgle, indtil adapteren skrives mod det verificerede API.
export function createPaymentProvider(env: Record<string, string | undefined> = process.env): PaymentProvider {
  const config = readConfig(env);
  if (isEnabled("payments", env) && isConfigured(config)) {
    // return new AluntaPaymentProvider(config);
  }
  return new StubPaymentProvider();
}
