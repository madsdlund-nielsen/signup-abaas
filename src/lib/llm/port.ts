export interface MeetingSummaryRequest {
  meetingId: string;
  transcript: string;
}

export interface MeetingSummary {
  summary: string;
  actionItems: string[];
}

/**
 * AI-mødeopfølgning. Leverandør: Ordbogen (Odin-LLM / OdinCore, dansk datacenter —
 * ADR 0024, 0058). Porten er leverandørneutral (ADR 0004).
 */
export interface LlmProvider {
  readonly name: string;
  summarizeMeeting(req: MeetingSummaryRequest): Promise<MeetingSummary>;
}
