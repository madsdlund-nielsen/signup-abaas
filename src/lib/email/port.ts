export interface EmailMessage {
  to: string;
  subject: string;
  /** Ren tekst — e-mailens tekstdel. */
  body: string;
  /** HTML-del. Allerede escapet af afsenderen (`renderTemplate`); adapteren tilføjer intet. */
  html?: string;
  /**
   * Afsenderens nøgle for netop denne besked. Leverandører der understøtter det (Resend)
   * afviser et dobbelt kald med samme nøgle — andet lag oven på vores egen idempotens.
   */
  idempotencyKey?: string;
}

/** Kvittering for en afsendelse. `reference` er leverandørens besked-id (`DEMO-MSG-…` i demo). */
export interface SendReceipt {
  reference: string | null;
}

/**
 * Transaktionsmails. Leverandør: Resend (EU, Dublin).
 * `send` kaster `ProviderError` hvis en konfigureret leverandør afviser kaldet; en stub
 * kaster aldrig (der blev intet forsøgt) og kvitterer uden reference.
 */
export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<SendReceipt>;
}
