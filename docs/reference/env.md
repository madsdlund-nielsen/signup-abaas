# Reference: miljøvariabler

> Genereret af `scripts/gen-reference.mjs` (`npm run docs:reference`). Redigér ikke i hånden — ret koden eller migrationerne og generér igen.

Udledt af `.env.example` (46 variabler) og `src/server/admin/launch-data.json`. Variabler med `NEXT_PUBLIC_` er offentlige by design (de bundles ind i klienten); alt andet er server-only. Ingen værdier her er hemmelige: eksemplet er tomt eller en offentlig standard. Produktionsværdier sættes i Netlify (Site configuration → Environment variables).

**Krav ved launch** er de variabler `/admin/klar` og `npm run launch:check` kræver sat.

## Feature-flags (default OFF; sæt =true for at aktivere en konfigureret adapter)

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `FLAG_BOOKING` | server | flag for port booking (tændt, når porten skal være rigtig) |  |  |
| `FLAG_VIDEO` | server | flag for port video (tændt, når porten skal være rigtig) |  |  |
| `FLAG_PAYMENTS` | server | flag for port payments (tændt, når porten skal være rigtig) |  |  |
| `FLAG_ACCOUNTING` | server | flag for port accounting (tændt, når porten skal være rigtig) |  |  |
| `FLAG_AIFOLLOWUP` | server | flag for port llm (tændt, når porten skal være rigtig) |  |  |
| `FLAG_TRANSCRIPTION` | server | flag for port transcription (tændt, når porten skal være rigtig) |  |  |
| `FLAG_EMAIL` | server | flag for port email (tændt, når porten skal være rigtig) |  |  |
| `FLAG_SMS` | server | flag for port sms (tændt, når porten skal være rigtig) |  |  |
| `FLAG_ANALYTICS` | server | flag for port analytics (tændt, når porten skal være rigtig) |  |  |

## Demo-tilstand (ADR 0041): dummy-implementeringer for de moduler der IKKE har nøgler

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `FLAG_DEMO` | server | skal være slukket |  | Rigtige nøgler vinder altid over demo. Alt demo returnerer er åbenlyst falsk (DEMO-/[DEMO]). Slås FRA før launch (docs/fase-6.md §6.4). |

## Database (Supabase Postgres) — region eu-north-1 (Stockholm), jf. ADR 0013

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `DATABASE_URL` | server |  |  |  |
| `TEST_DATABASE_URL` | server |  | `postgresql://postgres:postgres@localhost:5432/abaas_test` | db-tests mod lokal Postgres-container (docker-compose.test.yml): |

## Supabase Auth (auth-valg = Supabase Auth, ADR 0013)

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | offentlig | platform |  | URL + anon-nøgle er offentlige by design (klient-eksponeret via NEXT_PUBLIC_). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | offentlig | platform |  |  |
| `SUPABASE_SERVICE_ROLE_KEY` | server | platform |  | Service-role-nøgle: SERVER-ONLY hemmelighed — ALDRIG NEXT_PUBLIC_. Bruges kun server-side til rolle-opslag (bypasser RLS bevidst). Uden alle tre kører auth som stub (kontofri CI). |

## Adgangsport (ADR 0020) — delt adgangskode før auth. BRUGES IKKE p.t. (Mads, 2026-08-26);

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `APP_GATE_ENABLED` | server |  |  | variablerne er dokumenteret her fordi koden findes. Alle tre skal sættes for at porten er aktiv. Hash genereres med `node scripts/hash-gate-password.mjs <kodeord>` — aldrig kodeordet i klartekst. |
| `APP_GATE_PASSWORD_HASH` | server |  |  |  |
| `APP_GATE_COOKIE_SECRET` | server |  |  |  |

## Cal.com (booking, fase 2) — plan = TEAMS (ADR 0046). Platform-planen er lukket for

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `CALCOM_API_KEY` | server | port booking |  | nye kunder. Sæder = rådgivere + admin; ejere/kunder er attendees og koster ingen sæder. EU-residens på Teams er STADIG uverificeret (spike L-7) — gate før produktionsdata. |
| `CALCOM_TEAM_ID` | server | port booking |  | Teams-kontoens id — bruges KUN når admin opretter boardets collective event type (POST /v2/teams/{teamId}/event-types). Event type-id'et pr. board er IKKE env: det er tilstand i Supabase (board.calcom_event_type_id, migration 0019, ADR 0046). |
| `CALCOM_API_URL` | server |  |  | Valgfri: afviger ved cal.eu/self-host (default https://api.cal.com/v2). |
| `CALCOM_WEBHOOK_SECRET` | server | port booking |  | Webhook-signaturhemmelighed (SERVER-ONLY). Uden den svarer webhook-endpointet 503 — signaturverifikation stubbes aldrig (docs/stub-politik.md, ADR 0027). |

## Cal Video (multi-party video; optagelse ejes af Cal.com)

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `CALVIDEO_API_KEY` | server | port video |  |  |

## Alunta (betaling ind, ADR 0023/0032) — dansk udbyder; dataflow verificeret mod

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `ALUNTA_API_KEY` | server | port payments |  | OpenAPI-spec'en. Bearer-token fra Alunta (Laravel Passport OAuth2). |
| `ALUNTA_PLAN_ID` | server | port payments |  | Den FLAT-RATE-plan checkout-sessions oprettes mod (ADR 0056; ikke usage-plan). Planens pris er en pladsholder: vores pricing_rule beregner beløbet og sætter det på abonnementet pr. periode. ⚠ Alunta fakturerer i måneder, ikke uger — kadencen er et åbent Mads-punkt (backlog B-35). |
| `ALUNTA_API_URL` | server |  |  | Valgfri: afviger kun ved test-/self-host (default https://app.alunta.com/api/v1). |
| `ALUNTA_WEBHOOK_SECRET` | server | port payments |  | Webhook-signaturhemmelighed (SERVER-ONLY; sættes også i Alunta-UI'ets webhook-opsætning). Uden den svarer webhook-endpointet 503 — signaturverifikation stubbes aldrig (ADR 0027). |

## Planlagt kørsel: periode-opkrævninger (B-19, ADR 0056)

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `CRON_SECRET` | server | platform |  | Delt hemmelighed mellem Netlify scheduled function (netlify/functions/charge-periods.ts) og /api/cron/charge-periods (SERVER-ONLY). Uden den svarer routen 503 og funktionen kalder intet — kørslen åbnes aldrig uden hemmelighed. Generér en lang tilfældig streng; sæt den i Netlify env vars. |

## Bogføring ud (e-conomic ELLER Dinero — leverandørvalg uafklaret hos ejer)

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `ACCOUNTING_API_KEY` | server | port accounting |  |  |

## Ordbogen / OdinCore (chat.dk + ordbogen.ai → odincore.ai) — dansk datacenter, ADR 0024/0058.

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `ORDBOGEN_API_KEY` | server | port llm; port transcription |  | Én konto dækker LLM og transskription: sæt den FÆLLES nøgle, eller de to specifikke hvis Ordbogen udsteder nøgler pr. projekt (en specifik nøgle vinder over den fælles). Gatewayen er OpenAI-kompatibel (docs/spikes/ordbogen-api.md). Nøglen sendes kun over https. |
| `ORDBOGEN_API_URL` | server |  |  | Valgfri overstyringer — tom = dokumenteret default (https://api.odincore.ai/v1, odin-2, whisper-1). Modelnavnene er spec'ens eksempler og skal verificeres mod GET /v1/models (TODO(mads)). |
| `ORDBOGEN_LLM_MODEL` | server |  |  |  |
| `ORDBOGEN_TRANSCRIPTION_MODEL` | server |  |  |  |
| `LLM_API_KEY` | server | port llm |  | Porterne forbliver leverandørneutrale (ADR 0004), derfor de generiske navne som specifik override. |
| `TRANSCRIPTION_API_KEY` | server | port transcription |  | 🔴 Transskription kræver ejerens samtykkeflow til mødeoptagelse — uden det fejler den lukket (RecordingConsentMissingError), uanset nøgle og flag. Samtykke stubbes aldrig. |

## Resend (transaktionsmails, EU Dublin) — notifikationsmotoren, ADR 0057

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `RESEND_API_KEY` | server | port email |  | Kræver FLAG_EMAIL=true. Uden nøgler: demo (FLAG_DEMO) eller stub — aldrig en stille afsendelse. 🔴 EU-REGION vælges på AFSENDERDOMÆNET i Resend-UI'et (Domains → Add Domain → Region `eu-west-1`, Irland/Dublin) — IKKE i API-kaldet og ikke i nøglen. Opret domænet i EU FØR nøglen bruges. TODO(mads): bekræft regionen og notér den i docs/gdpr/leverandoer-register.md. |
| `RESEND_FROM_ADDRESS` | server | port email |  | Afsender på det verificerede domæne, fx `Navn <adresse@domæne>`. |

## inMobile (SMS, dansk) — kræver FLAG_SMS=true

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `INMOBILE_API_KEY` | server | port sms |  | ⚠ Adapteren er bygget mod bedste forståelse af inMobile API v4 og aldrig kørt mod en konto (TODO(mads): verificér mod inMobile live — se src/lib/sms/inmobile.ts). SMS kan desuden ikke sendes før telefonnumre findes i datamodellen (docs/stub-register.md). |
| `INMOBILE_SENDER` | server | port sms |  | Afsendernavn (alfanumerisk) eller -nummer. |

## Notifikationer: absolut app-URL til links i beskeder

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | offentlig | platform |  | Bruges også af betalingens success/back-URL'er. Uden den kan en besked med {{link}} ikke sendes (udsendelsen logges som fejlet: «variablen link har ingen værdi»). |

## Signerede engangslinks til rating (B-21, ADR 0060) — SERVER-ONLY

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `RATING_LINK_SECRET` | server | platform (mindst 32 tegn) |  | HMAC-hemmelighed til /vurdering/<token>: en vurdering fra en mail UDEN login. Mindst 32 tilfældige tegn (fx `openssl rand -base64 48`). Uden den — eller hvis den er for kort — er funktionen SLÅET FRA og fejler lukket: intet link udstedes eller kan indløses, og ratinganmodningen linker til det loginbeskyttede /moeder/[id]. Roteres den, ugyldiggøres alle udestående links. Sættes ÉT sted (Netlify env vars), aldrig NEXT_PUBLIC. |

## PostHog (analytics + fejlovervågning, EU) — fase 0, live-nøgle afventer

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `POSTHOG_KEY` | server | port analytics |  |  |
| `POSTHOG_HOST` | server | port analytics | `https://eu.posthog.com` |  |

## PostHog LÆSNING (driftsstatus på /admin/drift, ADR 0066) — SERVER-ONLY

| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |
|---|---|---|---|---|
| `POSTHOG_PERSONAL_API_KEY` | server |  |  | En personal API key (PostHog -> Personal API keys) med KUN scope query:read, scopet til dette projekt. IKKE POSTHOG_KEY (den kan kun skrive). Sættes i Netlify env vars, aldrig NEXT_PUBLIC. Uden dem viser /admin/drift "Ikke koblet på". Kræver FLAG_ANALYTICS=true. |
| `POSTHOG_PROJECT_ID` | server |  |  | Projektets numeriske id (står i URL'en: eu.posthog.com/project/<id>). |
| `POSTHOG_API_HOST` | server |  | `https://eu.posthog.com` | API-host til læsning. Default er EU-cloud; ændres kun ved self-host. Skal være https. |
