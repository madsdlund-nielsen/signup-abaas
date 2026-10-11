# 0058 — Ordbogen/OdinCore-adaptere: fælles klient og nøgle, synkron transskription, samtykke fejler lukket

- **Status:** Accepteret — delvist erstattet af 0065 (samtykkehullet er lukket: grundlaget er kontrakten, `getRecordingConsent` leverer det; adapterens og generatorens fail-closed-værn består)
- **Dato:** 2026-10-10
- **Fase:** 4 (4.3 transskription, 4.4 AI-opsummering)
- **Berører uafklaret punkt:** ja — **samtykke til mødeoptagelse** (ejer) bygges som et fail-closed hul, ikke besluttet

## Kontekst

ADR 0024 valgte Ordbogen til både transskription og LLM, og opdateringen fastslog: samme
konto, `ordbogen.ai` → `odincore.ai`, dansk datacenter. Portene (ADR 0004) stod som stubs
og demo (ADR 0041). Ved afsøgning 2026-10-10 viste det sig at gatewayen har en **offentlig
OpenAPI-spec** (`https://api.odincore.ai/swagger.json`) og er OpenAI-kompatibel —
`docs/spikes/ordbogen-api.md` skelner mellem det dokumenterede og det antagne.

Tre ting skulle afgøres: hvordan to adaptere deler konto og klient; om transskription er
synkron eller asynkron; og hvad der sker, når der ingen samtykkemekanisme findes.

## Overvejede muligheder

**Nøgle:**
- *Kun `LLM_API_KEY` + `TRANSCRIPTION_API_KEY`* — to variabler for én konto; nemt at glemme den ene.
- *Kun én `ORDBOGEN_API_KEY`* — enklest, men spec'en viser at nøgler er scopet til et **projekt**
  (`GET /v1/models` "for the authenticated project", `403` "key not permitted"), så to nøgler
  kan blive nødvendige.
- *Fælles nøgle som fallback, de to specifikke vinder.* **Valgt.**

**Transskription:**
- *Asynkront job + polling.* Findes ikke i spec'en — ville være opfundet.
- *Synkront multipart-kald* (`POST /v1/audio/transcriptions` → `{text}`). **Dokumenteret.** Valgt.

**Samtykke uden mekanisme:**
- *Spring over indtil videre / antag samtykke.* Forbudt (stub-politikken: samtykke stubbes aldrig).
- *Fejl lukket.* **Valgt.**

## Beslutning

1. **Én fælles klient** (`src/lib/ordbogen/client.ts`: Bearer-fetch, timeout, danske fejl, https-krav)
   bag to adaptere (`src/lib/llm/ordbogen.ts`, `src/lib/transcription/ordbogen.ts`). Ingen SDK.
2. **Nøgle:** `LLM_API_KEY` / `TRANSCRIPTION_API_KEY` vinder; ellers `ORDBOGEN_API_KEY`.
   Base-URL `ORDBOGEN_API_URL` (default `https://api.odincore.ai/v1`), modeller
   `ORDBOGEN_LLM_MODEL` (default `odin-2`) og `ORDBOGEN_TRANSCRIPTION_MODEL` (default
   `whisper-1`) — begge er spec'ens eksempelmodeller og skal verificeres (`TODO(mads)`).
   Valgreglen i factoryerne er uændret: flag + nøgle → rigtig; ellers demo (kun hvis nøglen mangler); ellers stub.
3. **Transskription er synkron.** Porten ændres additivt: `TranscriptionRequest` får valgfri
   `consent` og `audio`. Kaldet kan tage minutter for lang lyd, så det må **ikke** ligge i en
   sidevisning — "generér"-handlingen skal køre i en baggrundsfunktion og gemme resultatet
   (backlog B-45). Timeouts: 600 s transskription, 120 s LLM.
4. **Samtykke fejler lukket, to uafhængige led.** (a) `getMeetingSummary` henter først lyden når
   `getRecordingConsent()` returnerer et samtykke — og den returnerer altid `null`, fordi
   mekanismen ikke findes (`src/server/consent/recording.ts`, `TODO(ejer)`). (b) Selve adapteren
   kaster `RecordingConsentMissingError` uden samtykke for netop dette møde, før lyden
   inspiceres eller noget sendes. Demo-adapteren sender intet nogen steder og er uændret.
5. **Logning:** ingen transskripter, lyd eller request-bodies i fejl eller logs. Fejl bærer
   operation, status og leverandørens egen `type/code/message` (afkortet).
6. **Promptten** (dansk, neutral: resumé + handlingspunkter som JSON-skema) bor i
   `src/lib/llm/ordbogen.ts`; transskriptet markeres som data, ikke instruktioner. Tonen kan
   justeres af ejeren (`TODO(ejer)`).

## Konsekvenser

- Positive: adapterne er klar til nøglen; skiftet er konfiguration. Samtykkehullet er synligt og
  kan ikke omgås ved et uheld. Leverandøren kan udskiftes bag portene.
- Negative / pris: **uden samtykkemekanisme kan rigtig transskription ikke køre** — det er
  tilsigtet. Alt dokumenteret er kun testet mod mocket `fetch`, aldrig mod OdinCore live.
- Opfølgning:
  - ~~`TODO(ejer)`: samtykke til mødeoptagelse — mekanisme, tekst, tilbagekaldelse~~ → lukket af
    ADR 0065: samtykket er en del af kontrakten, `getRecordingConsent` returnerer `basis: "kontrakt"`
    for et møde der findes. Ingen tabel, ingen tilbagekaldelse. Værnene i punkt 4 består.
  - `TODO(mads)`: nøgle, modelnavne, grænser, dataresidens for API'et, Cal.com-optagelse (L-8);
    se spike-dokumentet.
  - Backlog B-45: gem resuméet som mødeartefakt og kør generering som baggrundsjob — i dag
    genereres ved hver sidevisning (skærm-først, ADR 0042), hvilket ikke må tændes mod en betalt API.
