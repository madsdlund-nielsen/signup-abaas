import { ProviderError, isRetryableStatus } from "../errors";
import type { ExceptionTypeCount, OpsMetrics, OpsMetricsProvider, OpsMetricsQuery } from "./port";

/**
 * Læse-adapter mod PostHog (EU) Query API (ADR 0066).
 *
 * Dokumenteret (posthog.com/docs/api/queries): `POST {host}/api/projects/:project_id/query/`,
 * `Authorization: Bearer <personal API key>` (nøglen skal have "Query Read"), body
 * `{ "query": { "kind": "HogQLQuery", "query": "<SQL>" } }`, svar med `results` som liste af
 * rækker. Projektgrænsen er 10 s eksekveringstid og en timebudget for personal API keys (429).
 *
 * Persondata: der sendes kun aggregerende SQL (tællinger), og vi gemmer/logger aldrig svaret.
 * Fejltypenavne filtreres til en positiv tegnliste, så en rå besked eller URL aldrig når siden.
 * Fejl bærer kun operation, HTTP-status og en dansk tekst — aldrig request- eller response-body.
 */

export const POSTHOG_DEFAULT_API_HOST = "https://eu.posthog.com";
const TIMEOUT_MS = 8_000;
const TOP_N = 3;
const VENDOR = "PostHog";
const OPERATION = "getOpsMetrics";

export interface PostHogOpsConfig {
  personalApiKey: string;
  projectId: string;
  /** Uden afsluttende skråstreg. */
  host: string;
}

function fail(status: number | null, detail: string, retryable: boolean): never {
  throw new ProviderError(VENDOR, OPERATION, status, detail, retryable);
}

function describeFailure(status: number): string {
  if (status === 401) return "læsenøglen er ugyldig eller mangler (HTTP 401).";
  if (status === 403) return "læsenøglen mangler scope 'Query Read' eller adgang til projektet (HTTP 403).";
  if (status === 404) return "projekt-id'et findes ikke på denne host (HTTP 404).";
  if (status === 429) return "PostHogs læsebudget eller rate limit er opbrugt — prøv igen senere (HTTP 429).";
  if (status === 400) return "PostHog afviste forespørgslen (HTTP 400).";
  if (status >= 500) return `PostHog har en intern fejl (HTTP ${status}).`;
  return `uventet svar fra PostHog (HTTP ${status}).`;
}

/** HogQL-literal for et tidspunkt. Bygget af `Date`, aldrig af fritekst — ingen injektion. */
function hogqlTime(d: Date): string {
  if (Number.isNaN(d.getTime())) fail(null, "ugyldigt tidspunkt.", false);
  // 'YYYY-MM-DD HH:MM:SS' i UTC. TODO(mads): verificér live at toDateTime(…, 'UTC') accepteres i HogQL.
  return `toDateTime('${d.toISOString().slice(0, 19).replace("T", " ")}', 'UTC')`;
}

/**
 * Fejltype ud af `$exception_types` (JSON-array som tekst) eller `$exception_type`.
 * Kun tegn der kan indgå i et typenavn slipper igennem; alt andet bliver til "Ukendt fejltype".
 */
export function exceptionTypeName(raw: unknown): string {
  let candidate: unknown = raw;
  if (typeof raw === "string" && raw.trimStart().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      candidate = Array.isArray(parsed) ? parsed[0] : undefined;
    } catch {
      candidate = undefined;
    }
  } else if (Array.isArray(raw)) {
    candidate = raw[0];
  }
  if (typeof candidate !== "string") return "Ukendt fejltype";
  const name = candidate.trim();
  return /^[A-Za-z_$][\w$.]{0,79}$/.test(name) ? name : "Ukendt fejltype";
}

function toCount(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) fail(null, "svaret havde et uventet format.", false);
  return Math.trunc(n);
}

function rowsOf(body: unknown): unknown[][] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results) || !results.every(Array.isArray)) {
    fail(null, "svaret havde et uventet format.", false);
  }
  return results as unknown[][];
}

/** Kolonner pr. række: [$exception_types, $exception_type, antal]. Samler efter normaliseret typenavn. */
export function summarizeExceptionTypes(rows: readonly unknown[][]): ExceptionTypeCount[] {
  const byType = new Map<string, number>();
  for (const row of rows) {
    const types = exceptionTypeName(row[0]);
    const type = types !== "Ukendt fejltype" ? types : exceptionTypeName(row[1]);
    byType.set(type, (byType.get(type) ?? 0) + toCount(row[2]));
  }
  return [...byType.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    .slice(0, TOP_N);
}

export class PostHogOpsMetricsProvider implements OpsMetricsProvider {
  readonly name = "posthog";

  constructor(private readonly config: PostHogOpsConfig) {}

  private async query(hogql: string): Promise<unknown[][]> {
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
      fail(null, "POSTHOG_API_HOST skal være https — læsenøglen sendes ikke i klartekst.", false);
    }

    let response: Response;
    try {
      response = await fetch(`${host}/api/projects/${projectId}/query/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${personalApiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "abaas-ops-metrics", query: { kind: "HogQLQuery", query: hogql } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        return fail(null, `tidsfristen på ${TIMEOUT_MS / 1000} sekunder blev overskredet.`, true);
      }
      return fail(null, "kunne ikke nå PostHog (netværksfejl).", true);
    }

    if (!response.ok) {
      // Svarteksten læses ikke: kun statussen bruges.
      return fail(response.status, describeFailure(response.status), isRetryableStatus(response.status));
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return fail(response.status, "svaret var ikke gyldig JSON.", false);
    }
    return rowsOf(body);
  }

  async getOpsMetrics({ since, activeSince }: OpsMetricsQuery): Promise<OpsMetrics> {
    const short = hogqlTime(since);
    const active = hogqlTime(activeSince);
    const earliest = hogqlTime(since < activeSince ? since : activeSince);

    // Én række: [hændelser, undtagelser, aktive personer]. TODO(mads): verificér live at
    // `person_id` og countIf/uniqIf er tilgængelige i HogQL på vores projekt.
    const totalsSql =
      `SELECT countIf(timestamp >= ${short}), countIf(event = '$exception' AND timestamp >= ${short}), ` +
      `uniqIf(person_id, timestamp >= ${active}) FROM events WHERE timestamp >= ${earliest}`;
    // Kun fejltypen — IKKE $exception_values/-message (kan indeholde persondata).
    // TODO(mads): verificér live hvilken af $exception_types / $exception_type projektets SDK sender.
    const typesSql =
      `SELECT properties.$exception_types, properties.$exception_type, count() FROM events ` +
      `WHERE event = '$exception' AND timestamp >= ${short} ` +
      `GROUP BY properties.$exception_types, properties.$exception_type ORDER BY count() DESC LIMIT 50`;

    const [totals, types] = await Promise.all([this.query(totalsSql), this.query(typesSql)]);
    const row = totals[0];
    if (!row || row.length < 3) fail(null, "svaret havde et uventet format.", false);

    return {
      events: toCount(row[0]),
      exceptions: toCount(row[1]),
      topExceptionTypes: summarizeExceptionTypes(types),
      activePeople: toCount(row[2]),
    };
  }
}
