/**
 * Fælles klient til Ordbogens/OdinCores API (ADR 0024 + 0058) — bruges af både LLM- og
 * transskriptionsadapteren, fordi det er ÉN konto og ÉT gateway. Rå fetch, Bearer-auth,
 * ingen SDK (arkitekturprincip 2). Typer herfra må ikke lække ud af adapterne.
 *
 * Kilde: gatewayens offentlige OpenAPI-spec (`https://api.odincore.ai/swagger.json`,
 * "Yavin API Gateway", OpenAI-kompatibel) — se `docs/spikes/ordbogen-api.md` for hvad der er
 * dokumenteret og hvad der er antaget.
 *
 * Persondata: mødeindhold (transskript, lyd) må ALDRIG ende i logs eller fejlbeskeder. Fejl
 * her bærer kun operation, HTTP-status og leverandørens egen fejlkode/-tekst — aldrig
 * request-body.
 */

/** Spec'ens basis (`/v1`-præfikset er en del af stierne). Overstyres af `ORDBOGEN_API_URL`. */
export const ORDBOGEN_DEFAULT_API_URL = "https://api.odincore.ai/v1";

export interface OrdbogenConfig {
  apiKey: string;
  /** Uden afsluttende skråstreg. */
  apiUrl: string;
}

export class OrdbogenError extends Error {
  constructor(
    public readonly operation: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`Ordbogen ${operation} fejlede: ${message}`);
    this.name = "OrdbogenError";
  }
}

function nonEmpty(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/**
 * Nøgle-opløsning: den specifikke variabel (`LLM_API_KEY` / `TRANSCRIPTION_API_KEY`) vinder,
 * ellers den fælles `ORDBOGEN_API_KEY`. Én konto dækker begge (ADR 0024), men nøgler kan være
 * scopet pr. projekt hos leverandøren (spec'en: "models available to the authenticated
 * project", 403 "key not permitted") — derfor bevares de to specifikke navne.
 */
export function resolveOrdbogenConfig(
  env: Record<string, string | undefined>,
  specificKey: string | undefined,
): { apiKey: string | undefined; apiUrl: string } {
  const apiKey = nonEmpty(specificKey) ?? nonEmpty(env.ORDBOGEN_API_KEY);
  const apiUrl = (nonEmpty(env.ORDBOGEN_API_URL) ?? ORDBOGEN_DEFAULT_API_URL).replace(/\/+$/, "");
  return { apiKey, apiUrl };
}

/** Nøglen sendes kun over TLS — undtagen mod localhost (lokale mock-servere). */
function assertSecureUrl(operation: string, url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OrdbogenError(operation, "ORDBOGEN_API_URL er ikke en gyldig URL.");
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !local) {
    throw new OrdbogenError(operation, "ORDBOGEN_API_URL skal være https — API-nøglen sendes ikke i klartekst.");
  }
}

/** Dansk, handlingsrettet fejltekst pr. status. Leverandørens egen tekst tilføjes kort. */
function describeFailure(status: number): string {
  if (status === 401) return "API-nøglen er ugyldig eller mangler (HTTP 401).";
  if (status === 403) return "API-nøglen har ikke adgang til operationen (HTTP 403).";
  if (status === 429) return "Rate limit eller budget er overskredet hos Ordbogen (HTTP 429).";
  if (status === 400 || status === 422) return `Ordbogen afviste forespørgslen (HTTP ${status}).`;
  if (status >= 500) return `Ordbogen har en intern fejl (HTTP ${status}) — prøv igen senere.`;
  return `Uventet svar fra Ordbogen (HTTP ${status}).`;
}

/** Spec'ens `ErrorResponse`: `{ error: { code, message, param, type } }`. */
function providerDetail(body: string): string {
  try {
    const e = (JSON.parse(body) as { error?: { code?: unknown; message?: unknown; type?: unknown } }).error;
    const parts = [e?.type, e?.code, e?.message].filter((p): p is string => typeof p === "string" && p !== "");
    return parts.join(" / ").slice(0, 200);
  } catch {
    return "";
  }
}

/**
 * Kald gatewayen (POST) med timeout. `init.body` er allerede serialiseret (JSON-streng eller
 * FormData); Content-Type sættes af kalderen for JSON og af fetch selv for FormData.
 */
export async function ordbogenFetch(
  config: OrdbogenConfig,
  operation: string,
  path: string,
  init: { body: string | FormData; contentType?: string; timeoutMs: number },
): Promise<unknown> {
  const url = `${config.apiUrl}${path}`;
  assertSecureUrl(operation, url);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
        ...(init.contentType ? { "Content-Type": init.contentType } : {}),
      },
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new OrdbogenError(operation, `tidsfristen på ${Math.round(init.timeoutMs / 1000)} sekunder blev overskredet.`);
    }
    throw new OrdbogenError(operation, "kunne ikke nå Ordbogen (netværksfejl).");
  }

  if (!response.ok) {
    const detail = providerDetail(await response.text().catch(() => ""));
    throw new OrdbogenError(operation, describeFailure(response.status) + (detail ? ` ${detail}` : ""), response.status);
  }

  try {
    return await response.json();
  } catch {
    throw new OrdbogenError(operation, "svaret var ikke gyldig JSON.", response.status);
  }
}
