/**
 * Registreret samtykke til optagelse af ét møde (ejerens punkt — må aldrig stubbes).
 * TODO(ejer): samtykke til mødeoptagelse — hvem giver det, hvordan registreres og tilbagekaldes
 * det. Typen er kun formen en kalder skal kunne fremvise; mekanismen er ikke besluttet.
 */
export interface RecordingConsent {
  meetingId: string;
  /** ISO 8601-tidspunkt for registreringen. */
  registeredAt: string;
}

/** Selve lyden, hentet af kalderen (porten henter ikke fra Cal.com — jf. spike L-8). */
export interface AudioPayload {
  data: Uint8Array;
  filename: string;
  /** Fx "audio/mpeg", "audio/wav", "audio/webm" (spec'en: WAV, MP3, WEBM). */
  contentType: string;
}

export interface TranscriptionRequest {
  meetingId: string;
  /** Reference til lydfil/optagelse. */
  audioRef: string;
  /**
   * Registreret optagelsessamtykke. Rigtige udbydere afviser uden det (fejler lukket); demoen
   * sender intet nogen steder og kræver det ikke.
   */
  consent?: RecordingConsent;
  /** Lyden. Rigtige udbydere kræver den; demoen ignorerer den. */
  audio?: AudioPayload;
}

export interface Transcript {
  text: string;
  /** BCP-47, fx "da-DK". */
  language: string;
}

/**
 * Transskription til auto-resumé. Leverandør: Ordbogen/OdinCore (ADR 0024, 0058). Porten er
 * leverandørneutral (ADR 0004), så udbyderen kan skiftes uden at røre domænet.
 */
export interface TranscriptionProvider {
  readonly name: string;
  transcribe(req: TranscriptionRequest): Promise<Transcript>;
}
