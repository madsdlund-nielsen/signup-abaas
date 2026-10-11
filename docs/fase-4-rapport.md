# Fase 4 — rapport: forberedelse, rating, AI-opsummering og notifikationer

> Hvad fase 4 leverede, hvad der er verificeret, og hvorfor fasen **ikke er lukket**:
> fire af de ti DoD-punkter kræver leverandørnøgler, Cal.com-optagelsen eller
> ejerbeslutninger. (Samtykke til optagelse, AI og SMS er siden 2026-10-11 en del af kontrakten, ADR 0065 — ikke en blokering.) Samme form som `docs/fase-2-rapport.md` og `docs/fase-3-rapport.md`.
>
> Status 2026-10-11: **bygget skærm-først, ikke lukket.** Lukning er Mads' beslutning.
> Kilder: `docs/fase-4.md`, ADR 0038, 0048, 0057-0061, `docs/stub-register.md`, `docs/backlog.md`.

## 1. Hvad fase 4 leverede (🟢 bygget)

| Arbejdspakke | Leverance | Hvor / ADR |
|---|---|---|
| **4.1 Forberedelsesmodul** | Dagsorden (`meeting_agenda_item`, delt: ejer, boardets partnere, admin), partnerens forberedelsesnote (`meeting_prep_note`, privat: forfatter + admin). Forberedelsesrummet ligger på `/moeder/[id]`. | Migration `0015_preparation_and_rating.sql`; `src/server/preparation/`; ADR 0038 |
| **4.2 Rating** | Vurdering af afholdt møde (`meeting_rating`, privat: afgiver + admin), 1-5 skala og valgfri kommentar. Aggregering pr. partner er en ren funktion; admin ser tallene på `/admin/vurderinger`. Ingen konsekvens i koden. | Migration `0015`; `src/server/ratings/`; ADR 0038 |
| **4.2 Signerede engangslinks (B-21, lukket)** | `rating_link` med HMAC over rækken, engangsbrug afgjort atomisk i basen (`redeem_rating_link`, revoked fra `anon`/`authenticated`). Siden `/vurdering/[token]`: kun POST indløser, ingen orakel. Fail-closed uden `RATING_LINK_SECRET` (≥ 32 tegn). | Migration `0023_rating_link.sql`; `src/server/ratings/link*.ts`; ADR 0060 |
| **4.3 Transskription (adapter)** | Ordbogen-adapter mod OdinCores offentlige OpenAPI-spec (`POST /v1/audio/transcriptions`, synkront). Fælles klient, ingen SDK. Fejler lukket uden grundlag for mødet (`RecordingConsentMissingError`; grundlaget er kontrakten, ADR 0065). | `src/lib/transcription/ordbogen.ts`, `src/lib/ordbogen/client.ts`; ADR 0058; `docs/spikes/ordbogen-api.md` |
| **4.4 AI-resumé (adapter + artefakt)** | Ordbogen-LLM-adapter (`/v1/chat/completions`, struktureret JSON-resumé). Resuméet gemmes som artefakt (`meeting_summary`, RLS: boardets ejer + admin) og genereres i baggrunden, ikke ved sidevisning. Kørsel: `/api/cron/summaries` + Netlify scheduled function `summaries` (hvert 15. min). `/moeder/[id]` læser den gemte række. Rå transskripter gemmes ikke. | Migration `0022_meeting_summary.sql`; `src/lib/llm/ordbogen.ts`; `src/server/summaries/`; `netlify/functions/summaries.ts`; ADR 0058, ADR 0059 (B-45 lukket) |
| **4.5 Notifikationsmotor** | Motor: reservér (idempotensnøgle, unik) → live skabelon → render → slå adresse op → send med op til 3 forsøg og backoff → log uden persondata → fejl til analytics-porten. Adaptere: Resend (`POST /emails`) og inMobile (API v4). Demo-/stub-valg følger ADR 0041. | Migration `0021_notification_template.sql`; `src/server/notifications/` (`engine.ts`, `render.ts`, `store.ts`, `scrub.ts`); `src/lib/email/resend.ts`, `src/lib/sms/inmobile.ts`; ADR 0048, ADR 0057 |
| **4.5 Oversigt** | `/admin/notifikationer`: de fire beskedtyper og den faktiske tilstand pr. kanal. Katalog i kode (`NOTIFICATION_TYPES`). | `src/server/notifications/catalog.ts`; ADR 0048 |
| **4.5 Aflysning/flytning** | Koblet på `rescheduleMeeting`/`cancelMeeting` (partnerne får besked, efter svaret via `after()`). Cal.com-webhookens ændringer giver samme besked (B-40 lukket). | `src/server/notifications/meetings.ts`; ADR 0057 pkt. 8 |
| **4.5 Fejlet betaling** | `notifyPaymentFailed` kaldes fra Alunta-webhookens `invoice.payment_failed` (B-41 lukket). | `src/app/api/webhooks/alunta/route.ts`; ADR 0057 |
| **4.5 Telefon og modtagernavn** | Telefonnummer på kontoen; motoren sender SMS når der er et nummer. (Den oprindelige SMS-opt-in er fjernet: samtykket er en del af kontrakten — migration `0027`, ADR 0065.) `{{modtager_navn}}` leveres fra kontoens visningsnavn. | Migration `0024_account_profile.sql`, `0027_contract_consent.sql`; `/konto`; `src/server/account/`; ADR 0061, 0065 |
| **4.6 Skabelon-editor** | `/admin/notifikationer/[type]` med live preview, LIVE/UDKAST-markering, advarsel når udkast afviger fra live, to-trins publicering og versionshistorik. Publicering er atomisk i basen (`publish_notification_template`). Live- og arkiverede versioner er uforanderlige (trigger). | `src/app/admin/notifikationer/[type]/`; `src/server/notifications/template-*.ts`; `src/components/` (`NotificationOverview`); ADR 0057 |

**Bevidst ikke leveret:** der er ingen skabelontekst. Tabellen starter tom, og motoren logger
`fejlet: ingen live skabelon` frem for at sende en opfundet tekst (ADR 0057 pkt. 1, stub-politik).
Der er heller ingen planlagt `/api/cron/notifications` (ruten er beskyttet, men ingen scheduled
function kalder den, jf. `netlify/functions/`).

## 2. Verifikation

| Gate | Status |
|---|---|
| `npm run lint` (kørt lokalt 2026-10-11) | 🟢 exit 0 |
| CI på HEAD `6536fd8` (run `38111121859`, branch `ccr-def7f2f1-4sa7q5`) | 🟢 Lint, Typecheck, Build, Unit tests, **Integration & DB tests** — alle `success` |
| `npm run test:db` lokalt | ❌ Ikke kørt — Docker mangler (`docs/backlog.md` B-13). CI er gaten for RLS. |
| Test-filer for fasen | Findes: `tests/db/preparation-rating-rls.test.ts`, `rating-link-rls.test.ts`, `meeting-summary-rls.test.ts`, `notification-template-rls.test.ts`, `account-profile-rls.test.ts`; integration: `notification-*.test.ts`, `summaries-*.test.ts`, `rating-link*.test.ts`, `ordbogen.test.ts`; unit: `template-editor.test.tsx`, `rating-link.test.ts`, `notification-render.test.ts`, `summary-status.test.ts`, `ratings-summary.test.ts`. Testcases er ikke gennemlæst i denne rapport. |
| **Ende-til-ende mod leverandører** | ❌ Ingen. Ingen Ordbogen-, Resend- eller inMobile-nøgle er sat, og ingen adapter er kørt mod en konto. |

Det grønne CI-run beviser at koden består sine tests. Det beviser ikke at et kald til
Ordbogen, Resend eller inMobile virker. Den distinktion gælder hele rapporten: en adapter der
er **bygget, ikke verificeret live**, er ikke et DoD-punkt der er opfyldt.

## 3. DoD-status punkt for punkt (`docs/fase-4.md`)

| # | Punkt | Status | Begrundelse |
|---|---|---|---|
| 1 | Forberedelsesmodul (dagsorden, spørgsmål) | ✅ | Bygget og CI-testet (ADR 0038, migration 0015). |
| 2 | 15 min betalt forberedelse, kobling til honorargrundlag | ✅ | Forberedelsesrummet bygget (ADR 0038). Honorargrundlaget er 60 + 15 min fra fase 2.4; beløbet er fase 5. |
| 3 | Rating efter møde, gemt i Supabase | ✅ (med forbehold) | Login-vejen og det signerede link er bygget og CI-testet (ADR 0060). **Forbehold:** ingen ratinganmodning sendes automatisk, fordi udsendelsestidspunktet er `null` (TODO(ejer)). Linket er kun aktivt med `RATING_LINK_SECRET`. |
| 4 | Transskription via Ordbogen bag `FLAG_TRANSCRIPTION` | ❌ | Adapter bygget (ADR 0058), **ikke kørt mod nøgle**, og optagelsen kan ikke hentes (L-8). Grundlaget (kontrakten, ADR 0065) er leveret; adapterens fail-closed-værn består. Tjekboksen er korrekt ❌. |
| 5 | Auto-resumé via Ordbogen bag `FLAG_AIFOLLOWUP` | ❌ | Adapter, gemt artefakt og baggrundskørsel er bygget (ADR 0059). Ingen leverandørkald er kørt. Rigtige møder ender som `mangler_optagelse` (L-8; tilsigtet). `mangler_samtykke` betyder nu kun «intet grundlag» (ukendt møde). |
| 6 | Notifikationsmotor: Resend (EU) og inMobile | **delvist** | Motor, adaptere, idempotent log og retry er bygget (ADR 0057). Begge adaptere er **aldrig kørt mod en konto**; inMobile er desuden uverificeret mod API v4 (`TODO(mads)`). Fejllogning går til analytics-porten, som er stub (`FLAG_ANALYTICS`). **Afvigelse:** `fase-4.md` har tjekboksen afkrydset, men punktet er ikke opfyldt i drift. |
| 7 | Admin redigerer skabeloner med live preview | ✅ (funktion) | Editoren og preview er bygget og testet (ADR 0057). Der findes ingen skabelontekst endnu, så ingen besked kan sendes før ejeren har skrevet den. |
| 8 | Visuel markering når en ændring er live | ✅ | LIVE/UDKAST-mærker, advarsel ved afvigelse og to-trins publicering (ADR 0057 pkt. 4). |
| 9 | Notifikationer dækker minimum (påmindelse, aflysning/flytning, ratinganmodning, fejlet betaling) | **delvist** | Aflysning/flytning er koblet (B-40). Fejlet betaling er koblet (B-41). Påmindelse og ratinganmodning er funktioner der «finder de skyldige + sender», men sender intet, fordi katalogets `schedule` er `null` (ADR 0057 pkt. 8). Ingen skabelontekst. |
| 10 | Fuld test suite grøn, inkl. RLS på ratings, resuméer og forberedelsesnoter | ✅ (CI) | CI er grøn på HEAD, inkl. Integration & DB tests. RLS-testfilerne findes. Lokal db-kørsel mangler (B-13). |

**Oversigt:** 6 ✅ (heraf to med forbehold: punkt 3 og 7), 2 delvist (punkt 6 og 9), 2 ❌
(punkt 4 og 5). Punkt 10 er ✅ alene på CI-grønt og lokal db-kørsel mangler.

## 4. 🔴 FLAG — uafklarede punkter berørt i fase 4

Alle står i kode med `TODO(ejer)` / `TODO(mads)` og i `docs/stub-register.md`. Ingen er besluttet her.

### 4.1 Åbne 🔴 — ejer (Andreas/Mette)

| Punkt | Hvor | Hvad det blokerer |
|---|---|---|
| ~~**Samtykke til mødeoptagelse**~~ → **lukket: del af kontrakten** (Mads, 2026-10-11) | `src/server/consent/recording.ts` (`getRecordingConsent` → `basis: "kontrakt"`) | Intet. Kontraktens ordlyd (ToS + honoraraftale, skal dække optagelse, AI og SMS) er stadig ejerens. ADR 0065 |
| **Note-synlighed**, inkl. resuméer og forberedelsesnoter | `meeting_note` (0012), `meeting_prep_note` (0015), `meeting_summary` (0022) | Ét svar lukker tre steder. Restriktiv default er aktiv. ADR 0038, 0059 |
| **Hvad ratings bruges til** | `meeting_rating` (0015) | Matching læser ikke ratings. Partneren ser ikke sine egne. ADR 0038 |
| **Rating-linkets levetid** | `src/server/ratings/link.ts` (`RATING_LINK_TTL_DAYS = 14`, teknisk default) | Hvor længe et link virker. ADR 0060 |
| **Udsendelsestidspunkt** for mødepåmindelse og ratinganmodning | `src/server/notifications/catalog.ts` (`schedule: null`) | Al planlagt udsendelse. Påmindelsen skal ligge før ændre-/aflyse-fristen (§12 pkt. 4), som også er uafklaret. ADR 0048, 0057 |
| **Ændre-/aflyse-vindue** | `src/server/meetings/actions.ts` (intet håndhæves) | Påmindelsens tidspunkt. Stub-register |
| **Skabelontekst** (emne og brødtekst pr. type og kanal) | `notification_template` (0021) er tom | Alle udsendelser. Forudsætter ToS (der også dækker SMS, ADR 0065). ADR 0048, 0057 |
| **Skal ejeren have bekræftelse ved aflysning/flytning?** | `src/server/notifications/meetings.ts` (kun partnerne får besked i dag) | Stub-register. Aflysning i Cal.com giver ejeren ingen besked, hvis partneren aflyser. |
| **Resumé-tone** (prompten) | `src/lib/llm/ordbogen.ts` | Kun kvaliteten af resuméet. ADR 0058 |
| ~~**SMS-samtykketekst**~~ → lukket (ADR 0065); **privatlivsvilkår/ToS** er stadig ejerens | `src/server/admin/legal.ts` | Forudsætning for `FLAG_SMS` i produktion. ADR 0061, 0065 |
| **Skal navn være påkrævet ved signup?** | `app_user.display_name` (frivilligt) | Om `{{modtager_navn}}` virker for alle modtagere. ADR 0061 |

### 4.2 Åbne 🔴 — Mads (teknisk og drift)

| Punkt | Hvor | Hvad det blokerer |
|---|---|---|
| **Ordbogen-nøgle**, modelnavne, grænser og API'ets dataresidens | `ORDBOGEN_API_KEY`, `ORDBOGEN_LLM_MODEL` (default `odin-2`, kun spec-eksempel), `ORDBOGEN_TRANSCRIPTION_MODEL` (default `whisper-1`, kun spec-eksempel) | 4.3, 4.4. ADR 0058, `docs/spikes/ordbogen-api.md` |
| **Netlify-funktionstid** mod 75 min transskription | `netlify/functions/summaries.ts`, `src/server/summaries/` | Om 3 møder pr. kald kan nå inden for grænsen. Fallback: Netlify Background Function. ADR 0059 |
| **`enqueueMissing`** bruger PostgREST embed-filter | `src/server/summaries/` | Testet mod en dobbelt, ikke mod en rigtig PostgREST. ADR 0059 |
| **Cal.com-optagelse** (`loadMeetingRecording`, spike L-8) | `src/server/summaries/recording.ts` | Rigtige møder ender i `mangler_optagelse`. Stub-register |
| **inMobile API v4** verificeres live | `src/lib/sms/inmobile.ts` (`TODO(mads)`) | `FLAG_SMS`. ADR 0057 |
| **Resend-domæne i EU-region** (`eu-west-1`) | Resend-UI (ikke i API-kaldet) | Dataresidens for e-mail. ADR 0057 |
| **Resend DPA og inMobile DPA**, og konti | `docs/gdpr/leverandoer-register.md` | Ingen udsendelse før DPA. Stub-register |
| **`RATING_LINK_SECRET`** (≥ 32 tegn) i Netlify | `src/server/ratings/link.ts` | Alle rating-links. Roteres secret, ugyldiggøres udestående links. ADR 0060 |
| **Resend click-tracking** slået fra for beskeder med `{{link}}` | Resend-UI | Ellers kan tokenet blive omskrevet i linket. ADR 0060 |
| **`CRON_SECRET`** i Netlify | `/api/cron/summaries` (503 uden secret) | Resumé-kørslen. ADR 0059 |
| **PostHog** (`FLAG_ANALYTICS`, live nøgle) | `src/lib/analytics/` (stub) | Fejlrapportering fra notifikationsmotoren. `docs/fase-4.md` §4.5 |
| **Netlify Functions-region = EU** | `netlify.toml` (`TODO(mads)`) | Gælder også `summaries`-funktionen. `netlify.toml` nævner Frankfurt, mens `docs/fase-2-rapport.md` nævner Ireland. Ét valg bør stå i ADR 0012. |
| **Docker lokalt** (B-13) | — | Lokal db-verifikation. Kun CI-gaten. |

## 5. Fund undervejs — kodegennemgang

Denne rapport er skrevet ud fra ADR'er, stub-register og backlog. Den er **ikke** en ny
kodegennemgang. Fasens egne ADR'er peger på tre forhold der er værd at holde øje med:

- **Ratinglinket er et bearer-link.** Videresendes mailen, kan modtageren af den videresendte
  mail vurdere på modtagerens vegne. ADR 0060 accepterer det med engangsbrug og levetid som værn.
  En tom kommentar via linket sletter aldrig en eksisterende kommentar (opdatering 2026-10-11).
- **Generér igen** har en 15 min-cooldown, så en ejer ikke kan udløse en løkke af betalte kald
  (ADR 0059, opdatering 2026-10-11).
- **Notifikationer og adresse.** Motoren sender kun til en kanal når adressen findes. En SMS
  uden telefonnummer logges som `fejlet: intet telefonnummer`, ikke som stille afsendelse
  (samtykket er kontraktens, ADR 0065 — ADR 0061 pkt. 5 er delvist erstattet).

## 6. Hvad der skal til før fasen kan kaldes lukket

Fasen lukkes **betinget** på samme måde som fase 2 og 3, hvis Mads accepterer det. Det
kræver, at følgende ligger klar, og at intet der mangler, bliver stille stub:

**A. Uden nøgler, kan gøres nu**

1. Afkryds i `docs/fase-4.md` rettes til det der er sandt: punkt 6 og 9 er delvist, og
   punkt 3 har forbehold. Det er en opfølgning, ikke en del af denne rapport.
2. Fase 4's flag-tilstand verificeres: `FLAG_TRANSCRIPTION`, `FLAG_AIFOLLOWUP`, `FLAG_EMAIL`,
   `FLAG_SMS` skal være slået fra i produktion, indtil punkterne under B og C er opfyldt.

**B. Med leverandørkonti (Mads)**

3. Ordbogen-nøgle og liveverifikation mod spec'ens modeller (§4.2 ovenfor).
4. Resend (EU-region, DPA) og inMobile (live-verifikation, DPA). Derefter `FLAG_EMAIL`.
5. `RATING_LINK_SECRET`, `CRON_SECRET`, og en rigtig rating-mail der gennemspiller linket
   inklusive Resend click-tracking.
6. Netlify-funktionstid og Functions-region målt mod en rigtig transskription.

**C. Ejerbeslutninger**

7. ~~Samtykke til optagelse~~ → del af kontrakten (ADR 0065). Ejeren skriver ToS og
   honoraraftale så de dækker optagelse, AI og SMS. Transskription og resumé for rigtige møder
   venter nu på nøgle og Cal.com-optagelsen (L-8).
8. Note-synlighed (dækker tre tabeller med én beslutning).
9. Udsendelsestidspunkter, skabelontekst og ratinglinkets levetid. Først da planlægges
   `/api/cron/notifications`, og først da sendes der noget.

**D. Gate før produktion (ikke før fase-lukning)**

10. `FLAG_DEMO` slås fra (`docs/fase-6.md` §6.4). Demo-adaptere må ikke være aktive ved launch.
11. Stub-register gennemgås (fase 6 §6.4). Punkterne i §4 ovenfor skal enten være løst eller have
    eksplicit ejer-accept.

## 7. Næste skridt

Kodedelen af fase 4 er færdig for det der kan bygges uden leverandører. Næste skridt er at få
nøglerne i spil og tage ejerbeslutningerne i §4.1. Fase 5 er rapporteret i
`docs/fase-5-rapport.md`; den har kun PostHog-driftstatus som leverandørafhængig rest.

Den største risiko i fase 4 er ikke teknisk: at et transskriptionskald, et resumé eller en mail
går ud uden grundlag og uden godkendt tekst. Derfor er alle tre veje fail-closed, og de skal
forblive det, indtil ejerbeslutningerne er taget.
