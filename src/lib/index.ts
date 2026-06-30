/**
 * Adapter-registry for sub-processorer (arkitekturprincip 2 i CLAUDE.md).
 *
 * Domæne- og feature-kode importerer KUN herfra (porte) — aldrig et
 * tredjeparts-SDK direkte. Hver adapter vælger sin implementering ud fra
 * feature-flag + konfiguration: uden flag/nøgler returneres en stub. Når
 * accounts/nøgler lander, udfyldes den rigtige adapter bag den uændrede port.
 *
 * Se docs/adr/0004-*.md (adapter-/port-mønster).
 */

import { createAccountingExporter } from "./accounting";
import { createAnalytics } from "./analytics";
import { createBookingProvider } from "./booking";
import { createEmailSender } from "./email";
import { createLlmProvider } from "./llm";
import { createPaymentProvider } from "./payments";
import { createSmsSender } from "./sms";
import { createTranscriptionProvider } from "./transcription";
import { createVideoProvider } from "./video";

import type { AccountingExporter } from "./accounting";
import type { Analytics } from "./analytics";
import type { BookingProvider } from "./booking";
import type { EmailSender } from "./email";
import type { LlmProvider } from "./llm";
import type { PaymentProvider } from "./payments";
import type { SmsSender } from "./sms";
import type { TranscriptionProvider } from "./transcription";
import type { VideoProvider } from "./video";

export { NotConfiguredError } from "./errors";

export type { AccountingExporter, AccountingExport, InvoiceLine } from "./accounting";
export type { Analytics, AnalyticsEvent } from "./analytics";
export type { BookingProvider, MultiHostMeetingRequest, ScheduledMeeting } from "./booking";
export type { EmailSender, EmailMessage } from "./email";
export type { LlmProvider, MeetingSummary, MeetingSummaryRequest } from "./llm";
export type {
  PaymentProvider,
  ChargeRequest,
  CardRegistration,
  CheckoutSession,
  PaymentFrequencyWeeks,
} from "./payments";
export type { SmsSender, SmsMessage } from "./sms";
export type { TranscriptionProvider, Transcript, TranscriptionRequest } from "./transcription";
export type { VideoProvider, VideoRoom, VideoRoomRequest } from "./video";

export interface Adapters {
  email: EmailSender;
  sms: SmsSender;
  analytics: Analytics;
  payments: PaymentProvider;
  booking: BookingProvider;
  video: VideoProvider;
  accounting: AccountingExporter;
  llm: LlmProvider;
  transcription: TranscriptionProvider;
}

/** Byg adapter-sættet ud fra env (flags + konfiguration). */
export function getAdapters(env: Record<string, string | undefined> = process.env): Adapters {
  return {
    email: createEmailSender(env),
    sms: createSmsSender(env),
    analytics: createAnalytics(env),
    payments: createPaymentProvider(env),
    booking: createBookingProvider(env),
    video: createVideoProvider(env),
    accounting: createAccountingExporter(env),
    llm: createLlmProvider(env),
    transcription: createTranscriptionProvider(env),
  };
}
