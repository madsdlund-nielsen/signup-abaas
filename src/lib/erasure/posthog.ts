import { ProviderError, isRetryableStatus } from "../errors";
import type { ErasureSubject, ProcessorEraser, ProcessorErasureReceipt } from "./port";

/**
 * PostHog (EU): sletning af en person og dennes hændelser og optagelser (ADR 0068).
 *
 * Dokumenteret (posthog.com/docs/privacy/data-storage, "Right to be forgotten"):
 *   `DELETE {host}/api/projects/:project_id/persons/:uuid/?delete_events=true&delete_recordings=true`
 *   med `Authorization: Bearer <personal API key>`. UUID'et er personens `id` i PostHog, IKKE vores
 *   bruger-id — det slås op først. Opslaget bruger HogQL-endpointet som `ops-metrics` allerede bruger
 *   (`POST /api/projects/:id/query/`) og den dokumenterede mapping `person_distinct_ids`:
 *   `SELECT id FROM persons WHERE id IN (SELECT person_id FROM person_distinct_ids WHERE distinct_id = '…')`.
 *
 * Distinct-id'et er bruger-id'et (en UUID, valideret før det indsættes i forespørgslen — ingen
 * injektion). Appen kalder i dag ikke `identify` med det (analytics-adapteren er en stub, og
 * besøgendes anonyme id'er kan ikke kobles til en konto), så en person der aldrig er identificeret
 * har intet at slette: `intet_at_slette`.
 *
 * Nøglen: den personlige nøgle skal have SKRIVE-scope til personer (`person:write`) — ikke blot
 * "Query Read" som drifts-læsningen. TODO(mads): bekræft scope og at `delete_recordings` accepteres
 * på vores projekt (aldrig kørt mod en konto). Fejl bærer kun operation og status — aldrig
 * svartekst, id eller adresse.
 */

export const POSTHOG_ERASURE_DEFAULT_HOST = "https://eu.posthog.com";
const VENDOR = "PostHog";
const OPERATION = "eraseDataSubject";
const TIMEOUT_MS = 8_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PostHogEraserConfig {
  personalApiKey: string;
  projectId: string;
  /** Uden afsluttende skråstreg. */
  host: string;
}

function fail(status: number | null, detail: string, retryable: boolean): never {
  throw new ProviderError(VENDOR, OPERATION, status, detail, retryable);
}

export class PostHogProcessorEraser implements ProcessorEraser {
  readonly processor = "posthog" as const;
  readonly name = "posthog";

  constructor(private readonly config: PostHogEraserConfig) {}

  private async call(path: string, init: { method: string; body?: string }): Promise<Response> {
    const { personalApiKey, projectId, host } = this.config;
    if (!/^\d+$/.test(projectId)) fail(null, "POSTHOG_PROJECT_ID skal være et tal.", false);
    let parsed: URL;
    try {
      parsed = new URL(host);
    } catch {
      return fail(null, "POSTHOG_API_HOST er ikke en gyldig URL.", false);
    }
    const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !local) {
      fail(null, "POSTHOG_API_HOST skal være https — nøglen sendes ikke i klartekst.", false);
    }
    try {
      return await fetch(`${host}/api/projects/${projectId}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${personalApiKey}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return fail(null, "kunne ikke nå PostHog (netværksfejl eller tidsfrist).", true);
    }
  }

  async eraseDataSubject(subject: ErasureSubject): Promise<ProcessorErasureReceipt> {
    if (!UUID.test(subject.userId)) fail(null, "bruger-id'et er ikke en UUID.", false);

    // 1. Slå personens PostHog-id op via distinct-id'et.
    const hogql =
      `SELECT id FROM persons WHERE id IN ` +
      `(SELECT person_id FROM person_distinct_ids WHERE distinct_id = '${subject.userId}')`;
    const lookup = await this.call("/query/", {
      method: "POST",
      body: JSON.stringify({ name: "abaas-erasure-lookup", query: { kind: "HogQLQuery", query: hogql } }),
    });
    if (!lookup.ok) fail(lookup.status, "opslag af personen fejlede.", isRetryableStatus(lookup.status));
    let rows: unknown;
    try {
      rows = ((await lookup.json()) as { results?: unknown }).results;
    } catch {
      return fail(lookup.status, "svaret på opslaget var ikke gyldig JSON.", false);
    }
    if (!Array.isArray(rows)) fail(lookup.status, "svaret på opslaget havde et uventet format.", false);
    const personIds = (rows as unknown[])
      .map((row) => (Array.isArray(row) ? row[0] : undefined))
      .filter((id): id is string => typeof id === "string" && UUID.test(id));
    if (personIds.length === 0) return { status: "intet_at_slette", reference: null };

    // 2. Slet personen (+ hændelser og optagelser). 404 = allerede væk → samme udfald.
    for (const personId of personIds) {
      const response = await this.call(`/persons/${personId}/?delete_events=true&delete_recordings=true`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) {
        fail(response.status, "sletning af personen fejlede.", isRetryableStatus(response.status));
      }
    }
    return { status: "slettet", reference: null };
  }
}
