import { DEMO_TEXT_PREFIX } from "../demo";
import type { Transcript, TranscriptionProvider, TranscriptionRequest } from "./port";

/**
 * Demo (ADR 0041): et fast transskript, så opfølgningsflowet kan klikkes igennem før
 * Ordbogen-DPA og samtykke til optagelse er på plads. Ikke afledt af nogen lyd.
 */
export class DemoTranscriptionProvider implements TranscriptionProvider {
  readonly name = "demo";

  async transcribe(req: TranscriptionRequest): Promise<Transcript> {
    return {
      text:
        `${DEMO_TEXT_PREFIX} Fast demo-transskript for optagelse ${req.audioRef} — ikke afledt af lyd. ` +
        "Ejer: Tak fordi I kunne. Jeg vil gerne starte med det der presser mest lige nu. " +
        "Partner: Lad os tage det først, og så vende de to andre punkter bagefter. " +
        "Ejer: Det lyder godt. Kan vi aftale hvem der gør hvad inden næste gang?",
      language: "da-DK",
    };
  }
}
