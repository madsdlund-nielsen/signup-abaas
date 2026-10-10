export interface SmsMessage {
  /** Modtager i E.164-format (fx +4512345678). */
  to: string;
  message: string;
  /** Afsenderens nøgle for netop denne besked (bruges som leverandørens egen besked-reference). */
  idempotencyKey?: string;
}

/** Kvittering for en afsendelse. `reference` er leverandørens besked-id (`DEMO-MSG-…` i demo). */
export interface SmsReceipt {
  reference: string | null;
}

/**
 * SMS (rating/påmindelser). Leverandør: inMobile (dansk).
 * `send` kaster `ProviderError` hvis en konfigureret leverandør afviser kaldet; en stub
 * kaster aldrig (der blev intet forsøgt) og kvitterer uden reference.
 */
export interface SmsSender {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsReceipt>;
}
