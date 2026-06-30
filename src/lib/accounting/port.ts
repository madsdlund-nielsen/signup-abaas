export interface InvoiceLine {
  description: string;
  /** Beløb i mindste valutaenhed (øre). */
  amountMinor: number;
  currency: string;
}

export interface AccountingExport {
  externalRef: string;
  customerRef: string;
  lines: InvoiceLine[];
}

/**
 * Bogføring ud (honorar/fakturering).
 * TODO(ejer): regnskabssystem e-conomic vs. Dinero er uafklaret — denne port
 * er leverandør-neutral, så valget kan træffes uden at røre domænet.
 */
export interface AccountingExporter {
  readonly name: string;
  exportInvoice(invoice: AccountingExport): Promise<{ id: string }>;
}
