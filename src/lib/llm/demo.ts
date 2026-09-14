import { DEMO_TEXT_PREFIX } from "../demo";
import type { LlmProvider, MeetingSummary, MeetingSummaryRequest } from "./port";

/**
 * Demo (ADR 0041): en fast opsummering, så skærmen til AI-opfølgning kan bygges og
 * designes før Ordbogen-DPA'en er på plads. Teksten er den samme hver gang og mærket
 * [DEMO] — den er ikke afledt af transskriptet og foregiver det ikke.
 */
export class DemoLlmProvider implements LlmProvider {
  readonly name = "demo";

  async summarizeMeeting(req: MeetingSummaryRequest): Promise<MeetingSummary> {
    return {
      summary:
        `${DEMO_TEXT_PREFIX} Fast demo-opsummering af møde ${req.meetingId} — ikke genereret ud fra mødet. ` +
        "Boardet gennemgik virksomhedens tre største udfordringer det kommende kvartal og prioriterede dem. " +
        "Rådgiverne pegede på ét område hvor ejeren bør handle nu, og to hvor det er klogere at afvente " +
        "mere data. Næste møde følger op på handlingspunkterne nedenfor.",
      actionItems: [
        `${DEMO_TEXT_PREFIX} Ejeren indhenter to tilbud på det prioriterede område inden næste møde`,
        `${DEMO_TEXT_PREFIX} Lead-partner sender et kort skriftligt oplæg om de to afventningspunkter`,
        `${DEMO_TEXT_PREFIX} Boardet følger op efter den aftalte mødefrekvens`,
      ],
    };
  }
}
