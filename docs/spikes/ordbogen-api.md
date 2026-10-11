# Spike — Ordbogen/OdinCore API (LLM + transskription)

> Fase 4.3/4.4, skive H. Undersøgt **2026-10-10** uden nøgle. Adapterne er bygget mod det der er
> **dokumenteret** (gatewayens offentlige OpenAPI-spec); alt andet er markeret **antaget** og står
> som `// TODO(mads): verificér mod OdinCore live` i koden og i `docs/stub-register.md`.
> Beslutningerne (fælles nøgle, synkron transskription) står i **ADR 0058**.

## Kilder

| Kilde | Hvad |
|---|---|
| `https://api.odincore.ai/swagger.json` (identisk på `https://api.ordbogen.ai/swagger.json`) | OpenAPI 3.1-spec, "Yavin API Gateway 1.0.0": *"OpenAI-compatible API for language, audio transcription, file, conversation, and vector-store operations."* Offentlig, kræver ingen nøgle. **Primær kilde.** |
| `https://odincore.ai`, `https://ordbogen.ai` (viderestiller til odincore.ai) | Ren SPA ("OdinCore.ai") — ingen tekstlig dokumentation i HTML'en. Ingen docs-side fundet (`docs.odincore.ai`, `developer.odincore.ai`, `/docs` giver 404/SPA). |
| `https://chat.dk` | Forbrugerproduktet. Meta-beskrivelse: *"Dansk data hører til i Danmark. Vores sprogmodel afvikles i Ordbogens danske datacentre med maksimalt privatliv under dansk lovgivning, GDPR og AI Act."* Provider-navn i metadata: `Odincore.ai`. |
| Live-probe af `GET https://api.odincore.ai/v1/models` uden nøgle | `401` `{"error":{"message":"Missing or invalid Authorization header","type":"invalid_token","param":"Authorization","code":null}}` — bekræfter Bearer-auth og fejlformen. |

Web-søgning efter dokumentation gav intet (ingen indeksering af odincore.ai).

## Dokumenteret (OpenAPI-spec'en)

**Fælles**

- Base-URL: `https://api.odincore.ai` med `/v1`-præfiks på alle stier (spec'ens kodeeksempler bruger `baseURL: "https://api.odincore.ai/v1"`). `api.ordbogen.ai` svarer med samme spec (alias).
- Auth: `Authorization: Bearer <API key>` (`securitySchemes.bearerAuth`, `bearerFormat: "API key"`). Spec'ens eksempel-env hedder `ODINCORE_API_KEY`.
- Fejlform (`ErrorResponse`): `{ "error": { "code": string|null, "message": string, "param": string|null, "type": string } }`.
- Statuskoder pr. operation: `400` ugyldig forespørgsel · `401` autentificering fejlet · `403` *"The API key is not permitted to perform this operation"* · `429` *"Rate limit or budget exceeded"* · `500`.
- Modeller: `GET /v1/models` — *"models currently available to the authenticated project"* (nøglen er altså scopet til et **projekt**; listen kræver nøgle).
- OpenAI-SDK'er virker pr. spec'ens eksempler — vi bruger dem **ikke** (arkitekturprincip 2); adapteren er rå `fetch`.

**Chat — `POST /v1/chat/completions`** (`ChatCompletionRequest`)

- Påkrævet: `model` (string), `messages[]` (roller `system`, `developer`, `user`, `assistant`, `tool`).
- Valgfri bl.a.: `temperature`, `top_p`, `max_completion_tokens`, `stop`, `stream`, `tools`/`tool_choice`, `reasoning_effort` (`none|low|medium|high|max`), `include_reasoning`, og `response_format` = `{type:"text"}` eller `{type:"json_schema", json_schema:{name, schema, strict, description}}`. Beskrivelsen: *"Parameter support can differ depending on the model"*.
- Svar (`ChatCompletionResponse`): `choices[].message.content`, `choices[].finish_reason`, `usage{prompt_tokens, completion_tokens, total_tokens, ...}`, `model`, `id`.
- Eneste modelnavn i dokumentationen: **`odin-2`** (curl-/SDK-eksemplet bruger det, prompten er dansk: *"Hej, snakker du dansk?"*).
- Streaming (SSE) findes; vi bruger det ikke.

**Transskription — `POST /v1/audio/transcriptions`** (`TranscriptionMultipartRequest`)

- `multipart/form-data`. Påkrævet: `file` (binær; *"Supported formats include WAV, MP3, and WEBM"*) og `model`.
- Valgfri: `language` (*"Hint to improve transcription accuracy for a specific language"*), `response_format` (`json` default | `verbose_json`), `stream`, `timestamp_granularities` (`word`/`segment`, kun `verbose_json`).
- Svar (`TranscriptionResponse`): `{ text, duration?, language?, model?, segments?, words? }` — **synkront JSON-svar**. Ingen asynkrone jobs, ingen polling. (Der findes en separat `/v1/uploads`-familie til store filer, men den er ikke koblet til transskription i spec'en.)
- Eneste modelnavn i dokumentationen: **`whisper-1`** (curl-/SDK-eksemplet).

**Andet i spec'en vi ikke bruger:** `completions`, `embeddings`, `responses`, `conversations`, `corrections` (dansk grammatikretning, "GEC"), `files`, `uploads`, `vector_stores`, `organization/{balance,usage,costs}` (kun for organisationer uden fakturering).

## IKKE dokumenteret (antaget — skal verificeres live)

| # | Hvad | Hvad adapteren gør | Markør |
|---|---|---|---|
| 1 | **Modelnavne i produktion.** `odin-2` og `whisper-1` er eksempler; `GET /v1/models` kræver nøgle. | Defaults `odin-2` / `whisper-1`, overstyres af `ORDBOGEN_LLM_MODEL` / `ORDBOGEN_TRANSCRIPTION_MODEL`. | `TODO(mads)` i `llm/ordbogen.ts`, `transcription/ordbogen.ts` |
| 2 | **`language`-format** (`da`? `da-DK`? `danish`?). Spec'en siger kun "hint". | Sender ISO 639-1 `da` (OpenAI-konventionen). Normaliserer svarets `language` til `da-DK`. | `TODO(mads)` |
| 3 | **`json_schema`-understøttelse for den valgte model.** | Sender `response_format: json_schema` (strict) og parser defensivt (tåler ```json-hegn; fejler højlydt ved forkert form). | `TODO(mads)` |
| 4 | **Rate limits, budgetloft, kvoter.** Kun `429` er nævnt; ingen headers eller tal. | Ingen retry; `429` giver en tydelig dansk fejl. | — |
| 5 | **Maks. filstørrelse/-varighed** for transskription (75 min lyd er stort). | Sender hele filen i ét kald. | `TODO(mads)` |
| 6 | **Svartid for lang lyd.** Kaldet er synkront. | Timeout 600 s (transskription) / 120 s (LLM) — vores valg, ikke leverandørens. | ADR 0058 |
| 7 | **Kontekstvindue** vs. et 75-minutters transskript (~10-12.000 ord). | Sender hele transskriptet; `max_completion_tokens: 2000`. | `TODO(mads)` |
| 8 | **Datalokation for API'et.** Kun forbrugerproduktet (chat.dk) oplyser "Ordbogens danske datacentre". API-spec'en nævner ingen region. Gatewayen svarer fra `91.240.88.26` (nginx). | Base-URL konfigurerbar (`ORDBOGEN_API_URL`) hvis Ordbogen giver en dedikeret/EU-endpoint. DPA er håndteret uden for repoet (ADR 0024-opdatering) — dataresidens for **API'et** bør stadig bekræftes skriftligt. | `TODO(mads)` |
| 9 | **Logning/opbevaring hos leverandøren** af prompts og lyd (retention, træning). | Ukendt; dækkes af den eksterne DPA. | — |
| 10 | **Om kontoens nøgle dækker begge** (LLM + transskription), eller om der udstedes pr. projekt. | Fælles `ORDBOGEN_API_KEY` som fallback; `LLM_API_KEY`/`TRANSCRIPTION_API_KEY` vinder hvis sat. | ADR 0058 |

## Hvad Mads skal hente hos Ordbogen

1. **En API-nøgle** (Bearer) til kontoen bestilt 2026-09-15 — og besked om den er én nøgle eller to (pr. projekt).
2. **Modelnavnene** til dansk opsummering og tale-til-tekst (`GET /v1/models` med nøglen). Er `odin-2` og `whisper-1` rigtige?
3. **Grænser:** maks. lydfil (MB/minutter), rate limit, budgetloft, kontekstvindue.
4. **Skriftlig bekræftelse** af at **API'et** (ikke kun chat.dk) kører i danske datacentre, samt retention/ikke-træning på API-data.
5. Om `language` skal være `da` eller andet, og om `response_format: json_schema` virker på den model vi bruger.

## Live-verifikation når nøglen lander

1. `FLAG_AIFOLLOWUP=true` + nøgle → kald `summarizeMeeting` med et kort, **fiktivt** dansk transskript; tjek JSON-formen og kvaliteten af resumé + handlingspunkter.
2. `FLAG_TRANSCRIPTION=true` → transskribér en **kort fiktiv** lydfil (ikke et rigtigt møde); tjek `language`, tegnsæt (æøå) og svartid.
3. Mål svartid for lang lyd (op mod 75 min) før transskriptionen lægges i en baggrundsfunktion (ADR 0058).
4. Bekræft fejlformerne (`401`/`429`) matcher `ErrorResponse`.

Intet af dette må køres på rigtig mødelyd før kontrakten (ToS + honoraraftale, der dækker optagelse og AI-behandling, ADR 0065) er indgået af deltagerne.
