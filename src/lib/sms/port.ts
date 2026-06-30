export interface SmsMessage {
  /** Modtager i E.164-format (fx +4512345678). */
  to: string;
  message: string;
}

/** SMS (rating/påmindelser). Leverandør: inMobile (dansk). */
export interface SmsSender {
  readonly name: string;
  send(message: SmsMessage): Promise<void>;
}
