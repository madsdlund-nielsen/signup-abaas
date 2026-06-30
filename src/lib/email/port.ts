export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

/** Transaktionsmails. Leverandør: Resend (EU, Dublin). */
export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}
