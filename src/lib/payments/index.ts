import { isEnabled } from "@/server/flags";
import { NotConfiguredError } from "../errors";
import { AluntaPaymentProvider } from "./alunta";
import type { CardRegistration, CheckoutSession, PaymentProvider, UsageChargeRequest } from "./port";

export type {
  CardRegistration,
  CheckoutSession,
  PaymentFrequencyWeeks,
  PaymentProvider,
  UsageChargeRequest,
} from "./port";

interface PaymentConfig {
  aluntaApiKey: string | undefined;
  aluntaPlanId: string | undefined;
  aluntaWebhookSecret: string | undefined;
  aluntaApiUrl: string;
  appUrl: string | null;
}

// Alunta er besluttet (ADR 0023); dataflow verificeret mod OpenAPI-spec'en (ADR 0030).
// MobilePay er IKKE en Alunta-gateway — evt. via valgt kort-gateway (OnPay/QuickPay), TODO(mads).
function readConfig(env: Record<string, string | undefined>): PaymentConfig {
  return {
    aluntaApiKey: env.ALUNTA_API_KEY,
    aluntaPlanId: env.ALUNTA_PLAN_ID,
    aluntaWebhookSecret: env.ALUNTA_WEBHOOK_SECRET,
    aluntaApiUrl: env.ALUNTA_API_URL ?? "https://app.alunta.com/api/v1",
    appUrl: env.NEXT_PUBLIC_APP_URL ?? null,
  };
}

function isConfigured(c: PaymentConfig): boolean {
  return Boolean(c.aluntaApiKey && c.aluntaPlanId);
}

/** Stub: kaster NotConfiguredError ved ægte backend-kald (intet kort/forbrug uden nøgler). */
class StubPaymentProvider implements PaymentProvider {
  readonly name = "stub";
  async registerCard(_reg: CardRegistration): Promise<CheckoutSession> {
    throw new NotConfiguredError("alunta", "registerCard");
  }
  async reportUsageCharge(_req: UsageChargeRequest): Promise<{ id: string }> {
    throw new NotConfiguredError("alunta", "reportUsageCharge");
  }
}

export function createPaymentProvider(env: Record<string, string | undefined> = process.env): PaymentProvider {
  const config = readConfig(env);
  if (isEnabled("payments", env) && isConfigured(config)) {
    return new AluntaPaymentProvider({
      apiKey: config.aluntaApiKey as string,
      planId: config.aluntaPlanId as string,
      apiUrl: config.aluntaApiUrl,
      appUrl: config.appUrl,
    });
  }
  return new StubPaymentProvider();
}
