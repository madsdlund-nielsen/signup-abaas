import { demoRef } from "../demo";
import type { ErasureSubject, ProcessorEraser, ProcessorErasureReceipt, ProcessorId } from "./port";

/**
 * Demo (ADR 0041): "sletter" ved at kvittere med et åbenlyst falsk id (`DEMO-ERASE-…`), så flowet
 * og kvitteringsskærmen kan klikkes igennem før leverandørnøglerne lander. Intet forlader processen,
 * og hverken id eller adresse logges.
 */
export class DemoProcessorEraser implements ProcessorEraser {
  readonly name = "demo";

  constructor(readonly processor: ProcessorId) {}

  async eraseDataSubject(_subject: ErasureSubject): Promise<ProcessorErasureReceipt> {
    console.info(`[erasure:demo] [DEMO] ville slette en registreret hos ${this.processor}`);
    return { status: "slettet", reference: demoRef("erase") };
  }
}
