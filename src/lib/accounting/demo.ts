import { demoRef } from "../demo";
import type { AccountingExport, AccountingExporter } from "./port";

/** Demo (ADR 0041): kvitterer for eksporten med en demo-reference. Ingen bogføring nogen steder. */
export class DemoAccountingExporter implements AccountingExporter {
  readonly name = "demo";

  async exportInvoice(_invoice: AccountingExport): Promise<{ id: string }> {
    return { id: demoRef("invoice") };
  }
}
