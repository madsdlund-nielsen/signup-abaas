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
  stripeSecretKey: string | undefined;
  stripeWebhookSecret: string | undefined;
  mobilepayMerchant: string | undefined;
}

function readConfig(env: Record<string, string | undefined>): PaymentConfig {
  return {
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    mobilepayMerchant: env.MOBILEPAY_MERCHANT_ID,
  };
}

function isConfigured(c: PaymentConfig): boolean {
  return Boolean(c.stripeSecretKey);
}

/** Stub: kaster NotConfiguredError ved ægte backend-kald (intet kort/træk uden nøgler). */
class StubPaymentProvider implements PaymentProvider {
  readonly name = "stub";
  async registerCard(_reg: CardRegistration): Promise<CheckoutSession> {
    throw new NotConfiguredError("stripe", "registerCard");
  }
  async charge(_req: ChargeRequest): Promise<{ id: string }> {
    throw new NotConfiguredError("stripe", "charge");
  }
}

// TODO: rigtig Stripe/MobilePay-adapter når STRIPE_SECRET_KEY m.fl. lander.
export function createPaymentProvider(env: Record<string, string | undefined> = process.env): PaymentProvider {
  const config = readConfig(env);
  if (isEnabled("payments", env) && isConfigured(config)) {
    // return new StripePaymentProvider(config);
  }
  return new StubPaymentProvider();
}
