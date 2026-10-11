import { ProviderError, isRetryableStatus } from "../errors";
import type { ErasureSubject, ProcessorEraser, ProcessorErasureReceipt } from "./port";

/**
 * Resend (EU, Dublin): sletning af en kontakt (ADR 0068).
 *
 * Dokumenteret (resend.com/docs/api-reference/contacts/delete-contact):
 *   `DELETE https://api.resend.com/contacts/{id_or_email}` med `Authorization: Bearer <nøgle>`;
 *   svaret er `{ object: "contact", contact: "<id>", deleted: true }`. Adressen kan bruges som nøgle.
 *   404 = kontakten findes ikke → `intet_at_slette`.
 *
 * Vi sender kun transaktionsmails og opretter ikke kontakter, så kontakten findes normalt ikke —
 * sletningen er en sikkerhedsforanstaltning, ikke hovedsagen. Det Resend GEMMER om os er mailloggen
 * (modtager, emne, status) i leverandørens egen retention; der er ingen dokumenteret API til at
 * slette sendte mails, så den er et manuelt punkt. TODO(mads): bekræft retention i Resend-kontoen
 * og at `/contacts/{email}` (ikke audience-scopet) gælder for vores konto-type.
 *
 * Fejl bærer kun operation og status — aldrig svartekst eller adresse.
 */

const ENDPOINT = "https://api.resend.com/contacts";
const TIMEOUT_MS = 8_000;

export class ResendProcessorEraser implements ProcessorEraser {
  readonly processor = "resend" as const;
  readonly name = "resend";

  constructor(private readonly config: { apiKey: string }) {}

  async eraseDataSubject(subject: ErasureSubject): Promise<ProcessorErasureReceipt> {
    let response: Response;
    try {
      response = await fetch(`${ENDPOINT}/${encodeURIComponent(subject.email)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.config.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ProviderError("Resend", "eraseDataSubject", null, "", true);
    }
    if (response.status === 404) return { status: "intet_at_slette", reference: null };
    if (!response.ok) {
      // Svarteksten læses ikke: den kan citere adressen.
      throw new ProviderError("Resend", "eraseDataSubject", response.status, "", isRetryableStatus(response.status));
    }
    return { status: "slettet", reference: null };
  }
}
