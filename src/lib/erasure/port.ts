/**
 * Sletning af en registreret hos en ekstern behandler (GDPR art. 17, ADR 0068).
 *
 * En metode pr. eksisterende port (e-mail, analytics, …) ville betyde en ny metode på hver — også
 * på dem hvor den rigtige adapter ikke findes endnu. Sletningen er en egen kapabilitet med egen
 * konfiguration (PostHogs sletning kræver en personal API key med skrive-scope, ikke ingest-nøglen;
 * Resends bruger samme nøgle som afsendelsen), så den bor i sit eget modul:
 * `src/lib/erasure/<behandler>.ts`.
 *
 * Kontrakt: `eraseDataSubject` er IDEMPOTENT. At personen ikke findes hos behandleren er et
 * vellykket udfald (`intet_at_slette`), ikke en fejl. Stubben kaster `NotConfiguredError`
 * (stub-politik: et manglende kald må aldrig læses som en gennemført sletning); en konfigureret
 * adapter kaster `ProviderError` hvis leverandøren afviser kaldet.
 */

export type ProcessorId = "posthog" | "resend";

export interface ErasureSubject {
  /** Det pseudonyme bruger-id (`app_user.id`) — analytics identificerer personen med det. */
  userId: string;
  /** Normaliseret e-mail. Sendes kun til leverandører der nøgler på den (Resend). */
  email: string;
}

export type ProcessorErasureStatus = "slettet" | "intet_at_slette";

export interface ProcessorErasureReceipt {
  status: ProcessorErasureStatus;
  /** Leverandørens egen reference hvis der er en (`DEMO-ERASE-…` i demo). Aldrig persondata. */
  reference: string | null;
}

export interface ProcessorEraser {
  readonly processor: ProcessorId;
  /** `posthog` | `resend` | `demo` | `stub` — samme skel som adapter-`name`, så skærmen kan vise hvad der kørte. */
  readonly name: string;
  eraseDataSubject(subject: ErasureSubject): Promise<ProcessorErasureReceipt>;
}
