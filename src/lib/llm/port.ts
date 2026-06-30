export interface MeetingSummaryRequest {
  meetingId: string;
  transcript: string;
}

export interface MeetingSummary {
  summary: string;
  actionItems: string[];
}

/**
 * AI-mødeopfølgning. Leverandør: Anthropic Claude API eller EU-hostet LLM.
 * TODO(mads): LLM EU-dataresidens/DPA skal verificeres før produktion.
 */
export interface LlmProvider {
  readonly name: string;
  summarizeMeeting(req: MeetingSummaryRequest): Promise<MeetingSummary>;
}
