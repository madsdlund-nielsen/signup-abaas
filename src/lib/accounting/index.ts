import { isEnabled } from "@/server/flags";
import { NotConfiguredError } from "../errors";
import type { AccountingExport, AccountingExporter } from "./port";

export type { AccountingExport, AccountingExporter, InvoiceLine } from "./port";

interface AccountingConfig {
  apiKey: string | undefined;
}

function readConfig(env: Record<string, string | undefined>): AccountingConfig {
  return { apiKey: env.ACCOUNTING_API_KEY };
}

function isConfigured(c: AccountingConfig): boolean {
  return Boolean(c.apiKey);
}

/** Stub: kaster NotConfiguredError — leverandørvalg (e-conomic/Dinero) afventer ejer. */
class StubAccountingExporter implements AccountingExporter {
  readonly name = "stub";
  async exportInvoice(_invoice: AccountingExport): Promise<{ id: string }> {
    throw new NotConfiguredError("accounting", "exportInvoice");
  }
}

// TODO(ejer): vælg e-conomic eller Dinero, og implementér en rigtig exporter.
export function createAccountingExporter(env: Record<string, string | undefined> = process.env): AccountingExporter {
  const config = readConfig(env);
  if (isEnabled("accounting", env) && isConfigured(config)) {
    // return new EconomicAccountingExporter(config); // eller DineroAccountingExporter
  }
  return new StubAccountingExporter();
}
