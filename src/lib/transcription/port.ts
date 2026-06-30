export interface TranscriptionRequest {
  meetingId: string;
  /** Reference til lydfil/optagelse. */
  audioRef: string;
}

export interface Transcript {
  text: string;
  /** BCP-47, fx "da-DK". */
  language: string;
}

/**
 * Transskription til auto-resumé.
 * TODO(mads): dansk/EU-transskriptionsudbyder afsøges — denne port er
 * leverandør-neutral, så udbyderen kan vælges uden at røre domænet.
 */
export interface TranscriptionProvider {
  readonly name: string;
  transcribe(req: TranscriptionRequest): Promise<Transcript>;
}
