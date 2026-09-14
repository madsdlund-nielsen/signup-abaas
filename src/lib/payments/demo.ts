import { demoCheckoutPath, demoRef } from "../demo";
import type { CardRegistration, CheckoutSession, PaymentProvider, UsageChargeRequest } from "./port";

/**
 * Demo (ADR 0041): kortregistrering uden Alunta/QuickPay.
 *
 * `registerCard` sender ejeren til appens egen demo-checkout i stedet for leverandørens
 * hostede side. Bekræftelsen dér udfører samme tilstandsskift som checkout.completed-
 * webhooken (`confirmDemoCard` i src/server/memberships/actions.ts) — og afvises når
 * denne provider ikke er den aktive. `reportUsageCharge` kvitterer med en demo-reference;
 * opkrævningen står derefter som "indberettet", præcis som hos leverandøren indtil dennes
 * faktura-webhook. Der trækkes aldrig penge nogen steder.
 */
export class DemoPaymentProvider implements PaymentProvider {
  readonly name = "demo";

  async registerCard(reg: CardRegistration): Promise<CheckoutSession> {
    // customerRef er membership-id'et (external_customer_id, ADR 0032) — demo-checkouten bærer det videre.
    return { id: demoRef("checkout"), url: demoCheckoutPath(reg.customerRef) };
  }

  async reportUsageCharge(_req: UsageChargeRequest): Promise<{ id: string }> {
    return { id: demoRef("charge") };
  }
}
