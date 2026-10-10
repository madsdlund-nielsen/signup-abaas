# Stub-register

> Alle aktive stubs og beslutnings-pladsholdere. Reglerne står i
> `docs/stub-politik.md`. **Registrér i samme PR som stubben opstår.**
> Fase 6 (§6.4) gennemgår registret: hver post skal være løst eller have eksplicit
> ejer-accept før launch.
>
> Sidst gennemgået: 2026-10-10 (Cal.com collective event type pr. board, ADR 0046/B-23; admin-drift og juridisk interface, ADR 0053; rolle-dashboards, ADR 0055; betaling omlagt til abonnement pr. 4. uge, ADR 0056).

## Backend-stubs — kaster `NotConfiguredError`

Aktiv når `isEnabled(<flag>) && isConfigured(config)` ikke er opfyldt. Kan ikke
udføre ægte kald, og lader være med at foregive andet.

| Modul | Flag | Låses op af | Skylder svar |
|---|---|---|---|
| `src/lib/booking/` (Cal.com) | `FLAG_BOOKING` | **Adapteren er reworket til collective event type pr. board** (ADR 0046, B-23 lukket) — men aldrig kørt mod en konto. Låses op af: **(a)** Cal.com **Teams**-konto + `CALCOM_API_KEY`/`CALCOM_TEAM_ID`/`CALCOM_WEBHOOK_SECRET`, **(b)** admin: Cal.com-sæde på hver partner + "Opret Cal.com-event type" pr. board (`/admin/boards`), **(c)** liveverifikation L-1/L-3…L-10. Uden event type på boardet fejler booking højlydt. `// TODO(mads)`: ejerens tidszone/navn gemmes ikke (fast `Europe/Copenhagen`, e-mail som navn); partnerudskiftning opdaterer ikke hosts automatisk. ~~plan-/tier-STOP~~ → lukket: Teams | Mads |
| `src/lib/video/` (Cal Video) | `FLAG_VIDEO` | ~~Cal.com-plan~~ (lukket: Teams, ADR 0046) + EU-residens (spike L-7); mødeoptagelse kræver desuden native støtte på Teams (L-8) **og** samtykkeflow | Mads + ejer |
| `src/lib/payments/` (Alunta) | `FLAG_PAYMENTS` | **Adapteren følger nu abonnementsmodellen** (ADR 0034/0056, B-19 lukket): checkout opretter abonnementet, `upsertSubscription` sætter prisen (`PUT /subscriptions/{uuid}/price`), webhooks melder tilbage. Låses op af: Alunta-UI-opsætning (**flat-rate-plan** + webhook-secret) → `ALUNTA_API_KEY`/`ALUNTA_PLAN_ID`/`ALUNTA_WEBHOOK_SECRET`/`CRON_SECRET` + `FLAG_PAYMENTS` → live-verifikation i test_mode. 🔴 **Alunta fakturerer i måneder, ikke uger** — 4-ugers-kadencen kan ikke udtrykkes (B-35, `TODO(mads)` i `alunta.ts`). ~~Gateway-valget~~ → lukket: **QuickPay** (gateway) + **Nets** (indløser) — to selvstændige konti (ADR 0034-opdatering) | Mads |
| `src/lib/accounting/` | `FLAG_ACCOUNTING` | Leverandørvalg: e-conomic vs. Dinero | Ejer |
| `src/lib/llm/` (Ordbogen Odin) | `FLAG_AIFOLLOWUP` | **Adapter bygget** (ADR 0058, mod OdinCores offentlige OpenAPI-spec — `docs/spikes/ordbogen-api.md`) men aldrig kørt mod nøgle. Låses op af: `ORDBOGEN_API_KEY` (eller `LLM_API_KEY`) + flag. `// TODO(mads)`: verificér mod OdinCore live — modelnavn (`odin-2` er kun spec'ens eksempel), `json_schema`-understøttelse, kontekstvindue vs. 75 min transskript. `// TODO(ejer)`: resumé-tone (prompten). Resuméet gemmes endnu ikke (B-45). ~~Ordbogen-DPA~~ → håndteret uden for repoet | Mads |
| `src/lib/transcription/` (Ordbogen) | `FLAG_TRANSCRIPTION` | **Adapter bygget** (ADR 0058, `POST /v1/audio/transcriptions`) men aldrig kørt mod nøgle. Låses op af: nøgle + flag **og** 🔴 **samtykke til optagelse (ejer)** — mekanismen findes ikke, så `getRecordingConsent` (`src/server/consent/recording.ts`) svarer altid `null` og transskription **fejler lukket** (`RecordingConsentMissingError`, to led: service + adapter). Må aldrig stubbes. Desuden hul: `loadMeetingRecording` (`src/server/summaries/recording.ts`) — Cal.com-optagelse (spike L-8). `// TODO(mads)`: modelnavn (`whisper-1` er spec'ens eksempel), `language`-format, max filstørrelse, svartid (kaldet er synkront) | Mads + ejer |

## Demo-implementeringer (ADR 0041) — ikke huller

Aktive når `FLAG_DEMO` er sat **og** modulets rigtige config mangler. Rigtige nøgler vinder
altid. Alt de returnerer er åbenlyst falsk. **`FLAG_DEMO` skal være slået fra ved launch**
(fase 6 §6.4).

| Modul | `demo.ts` | Hvad demoen gør |
|---|---|---|
| `src/lib/booking/` | ✅ | Bekræfter tidspunktet uændret; "Deltag" → `/moeder/rum/[uid]`. Tjekker ingen kalendere. Boards uden event type bookes med det falske `DEMO_EVENT_TYPE_ID` (gemmes aldrig); "Opret event type" i demo gemmer intet |
| `src/lib/video/` | ✅ | Møderum → `/moeder/rum/[meetingId]` |
| `src/lib/payments/` | ✅ | Kortregistrering → `/betaling/demo-kort/[membershipId]` (bekræftes af `confirmDemoCard`, som også sætter periodeankeret og `DEMO-SUB-…`); abonnementet kvitteres med `DEMO-SUB-…` |
| `src/lib/accounting/` | ✅ | Kvitterer med `DEMO-INVOICE-…` |
| `src/lib/llm/` | ✅ | Fast `[DEMO]`-opsummering med tre handlingspunkter |
| `src/lib/transcription/` | ✅ | Fast `[DEMO]`-transskript, `da-DK` |
| `email`, `sms`, `analytics` | — | Fire-and-forget-stubs logger og resolver allerede |

## Fire-and-forget-stubs — logger og resolver

Manglende kald ændrer ikke forretningstilstand, så stubben logger hvad den ville
have gjort.

| Modul | Flag | Låses op af | Skylder svar |
|---|---|---|---|
| `src/lib/email/` (Resend) | `FLAG_EMAIL` | Konto + nøgle + DPA. Bruges også til Supabase-SMTP (fase 1-opfølgning) | Mads |
| `src/lib/sms/` (inMobile) | `FLAG_SMS` | Konto + nøgle + DPA | Mads |
| `src/lib/analytics/` (PostHog EU) | `FLAG_ANALYTICS` | Live projektnøgle | Mads |

## Auth

| Sted | Hvad | Låses op af | Skylder svar |
|---|---|---|---|
| `StubSessionProvider` (`src/server/auth/index.ts`) | Returnerer `null` som nuværende bruger når Supabase Auth ikke er konfigureret — holder kontofri CI/dev kørende | Ikke et åbent punkt: aktiv Supabase-konfiguration slår den fra automatisk (ADR 0013) | — |

## Beslutnings-pladsholdere

Huller der ikke kan fejle højlydt, fordi funktionen skal returnere noget. Neutrale og
deterministiske frem for plausible — se `docs/stub-politik.md`.

| Sted | Pladsholder | Rigtig regel afventer | Skylder svar |
|---|---|---|---|
| `src/server/matching/algorithm.ts:47` | Tie-break sorterer på `sort_order`, navn, id | Byggespec §5.2 flager punktet og henviser til §12 — **det punkt findes ikke** i §12's tabel (3, 20 og 23 mangler). Punktet har derfor ingen ejer endnu | Ejer |
| `src/server/matching/algorithm.ts:145` | Infobaren viser **kompetence-delta**, ikke pris | §5.2 kræver "løbende pris" + "præcist prisregnestykke"; startpris/meeting-fee er ikke fastlagt. `docs/fase-1.md` er styrende indtil da | Ejer |
| `src/server/boards/actions.ts:88,162,195` | Lead-partner sættes på den første interne partner | Tildelings- og rotationsregler (byggespec §12 pkt. 15). Manuel markering ligger bag flaget `leadPartner` (OFF) | Ejer |
| `src/server/matching/index.ts:101` | Udskift viser hele puljen | §5.2 kræver "kun partnere med kalenderplads". Tilgængelighedsdata findes nu (`partner_availability`, 0018, ADR 0052), så filteret *kan* bygges uden Cal.com — men "kalenderplads" er ikke defineret: hvor mange ledige timer, i hvilken periode, og skal en partner uden angivet tilgængelighed tælle med? Derfor stadig hele puljen | Ejer (definition) |
| `src/server/availability/algorithm.ts` (`isRestricted`) | **"Ikke angivet" = ingen begrænsning:** en partner uden ugevinduer kan bookes på alle tidspunkter (fravær gælder dog altid). Ellers kunne ingen booke et board før alle partnere har udfyldt skemaet | Skal en partner der ikke har angivet tilgængelighed i stedet være "ikke bookbar"? Skærmen `/partner/tilgaengelighed` oplyser reglen for partneren (ADR 0052) | Ejer |
| `src/server/availability/` (synk) | **Tilgængelighed lever kun i Supabase** — Cal.com kender den ikke, så en booking oprettet direkte hos Cal.com omgår vagten i `meetings/actions.ts` | Envejs synk `partner_availability` → Cal.com-schedules efter B-23 (collective event types) og en Teams-konto; hører under liveverifikationen i `docs/spikes/multi-host.md`. TODO(mads) | Mads |
| `src/server/flags/index.ts:53` | `inAppMessaging` er hårdkodet `false` uanset env | Hele modulet er uafklaret — scope og om det overhovedet skal med | Ejer |
| `src/server/meetings/actions.ts` (reschedule/cancel) | **Intet ændre-/aflyse-vindue håndhæves** — ejeren kan flytte/aflyse frit | Byggespec §12 pkt. 4: hvor langt inden mødet må der ændres/aflyses? Reglen tilføjes som konfiguration | Ejer |
| `src/server/meetings/actions.ts` (registerMeetingStatus) | `forsinket_afbud`/`udeblivelse` registreres uden konsekvens for mødets livscyklus. Honorarkonsekvensen er flyttet til `fee_rule.absence_rule` (se nedenfor) | Honorar ved udeblivelse/sent afbud (§12 pkt. 13) | Ejer |
| `supabase/migrations/0012_meeting.sql` (meeting_note-RLS) | Note-synlighed: restriktiv default (forfatter + board-ejer) | Hvem må se møde-noter (§12 pkt. 16)? Udvidelse er én policy | Ejer |
| `src/app/moeder/[id]/page.tsx` (AI-opsummering) | Opsummeringen vises **kun for ejeren** — restriktiv default håndhævet i siden, da der endnu ikke findes en tabel at lægge RLS på (skærm-først, fase 4.4) | Note-synlighed (§12 pkt. 16) gælder også resuméer. Når resuméet får en tabel, flytter reglen til RLS | Ejer |
| `pricing_rule` (0013) | **Ingen aktiv prisregel findes** — beregning og charge-grundlag er slået fra indtil admin aktiverer en version. Demo-seed'et (ADR 0043) kan indsætte en åbenlyst falsk 1-kr-regel sammen med en demo-ejer, kun hvor ingen aktiv findes — demodata, ikke en pladsholder i kode | Startpris/meeting-fee + frekvensfaktorer (§12 pkt. 2). Tal indtastes af admin, aldrig af kode | Ejer |
| `src/server/notifications/index.ts` (`NOTIFICATION_TYPES`) | **Udsendelsestidspunkt for mødepåmindelse og ratinganmodning er `null`** — skærmen viser "Ikke fastlagt" frem for et tal. De to øvrige typer udløses direkte af en hændelse og har derfor et tidspunkt uden at nogen har valgt det | Hvor længe før mødet påmindes der, og hvor hurtigt efter et møde bedes om rating? Påmindelsen hænger sammen med ændre-/aflyse-vinduet (§12 pkt. 4): en påmindelse efter fristen for at flytte er værdiløs. Skabelonteksten mangler også, og forudsætter ToS/samtykke (ADR 0048) | Ejer |
| `fee_rule` (0017) + `src/server/fees/` | **Ingen honorarregel findes** — ingen partner-linje får et beløb; `/partner/honorar` siger "Honorarsatsen er ikke fastlagt endnu", og `/admin/honorar` viser linjer som "ingen sats". Demo-seed'et (ADR 0043/0051) kan indsætte en åbenlyst falsk regel på 1 kr i timen, kun hvor ingen regel findes — demodata, ikke en pladsholder i kode | Honorarsats pr. partner pr. møde (§12 pkt. 1). Admin indtaster satsen i `/admin/honorar`; grundlaget er 75 min (60 + 15) | Ejer |
| `fee_rule.vat_mode` (0017), `src/server/fees/algorithm.ts` | Moms på honorar er `ikke_fastlagt` (default). Beløbet vises uden momsbehandling, og **koden beregner aldrig en momssats** — også når admin sætter `ekskl_moms`/`inkl_moms`, videregives kun måden, så bogholderen ikke får en antagelse serveret som et tal | Moms på partner-honorar (§12 pkt. 14). Om og hvordan moms lægges til/trækkes fra er ejerens/bogholderens anvendelse af reglen | Ejer |
| `fee_rule.absence_rule` (0017), `src/server/fees/algorithm.ts` | Forsinket afbud/udeblivelse er `ikke_fastlagt` (default): linjen får status `afventer_regel` — grundlaget er registreret, intet beløb er medregnet, og opgørelsen siger det | Honorar ved udeblivelse/sent afbud (§12 pkt. 13). Værdierne `intet_honorar`/`fuldt_honorar` er klar; en mellemting (fx delvist honorar) er et nyt enum-valg og dermed en ejerbeslutning | Ejer |
| `src/app/admin/honorar/eksport/route.ts`, `src/lib/accounting/` | Opgørelsen eksporteres som **CSV** (rå øre, ingen moms) — der er ingen forbindelse til et regnskabssystem, og **udbetaling er ikke automatiseret**. `src/lib/accounting/` forbliver på stub | Regnskabssystem: e-conomic vs. Dinero (§12) samt om udbetaling skal automatiseres ved launch (`docs/fase-5.md` §5.2) | Ejer |
| `src/components/Dashboard.tsx` (`RatingsPanel`) | **Partnerens egne vurderinger vises ikke på dashboardet** — panelet siger det højt. RLS (0015) lader kun den der afgav en vurdering og admin læse `meeting_rating`; den vurderede partner ser den ikke, og der er bevidst ikke bygget en ny læsevej (ADR 0055) | Hvad vurderinger skal bruges til, og om en partner må se sine egne (gennemsnit/antal)? Svaret låser op for en view-læsevej som `partner_fee_line` (§4.2, B-07) | Ejer |
| `src/server/dashboard/index.ts` (`getLeadBoardNeeds`) | **Lead-partneren ser ejerens kompetencebehov** (kun tag-id'er) via service-role bag et lead-tjek — ikke via RLS. Hvem der er lead afgøres af `board_partner.is_lead` i data, uanset flaget `leadPartner` (ADR 0055) | (1) Lead-tildeling og -rotation (§12 pkt. 15). (2) Skal ejeren informeres om at boardets lead ser hendes behov? Vilkår/privatlivstekst (ToS) | Ejer |
| `src/server/pricing/algorithm.ts` | Beløb er rå øre uden momslogik | Moms på partner-honorar/beløbsvisning (§12 pkt. 14) | Ejer |
| `src/app/admin/drift/page.tsx` (PostHog-driftstatus) | **Ingen fejlrate/seneste fejl vises** — kun et link til PostHog (EU). Analytics-porten er en stub og har ingen query-grænseflade (ADR 0053) | Live PostHog-projektnøgle + en læse-adapter bag analytics-porten. Ingen falske tal før da | Mads |
| `src/server/admin/legal.ts` (ToS + honoraraftale) | Begge står som **"Ikke udarbejdet — afventer ejer"** på `/admin/juridisk`. Interfacet er bygget, indholdet findes ikke | ToS og honoraraftale (CLAUDE.md, uafklarede punkter); honoraraftalen hænger sammen med honorarsats/moms (§12) | Ejer |
| `src/server/consent/` (samtykkelog) | **Der findes ingen samtykketabel** — samtykke er en typet kerne + en cookie i browseren; ingen bevis for hvem der sagde ja til hvad og hvornår. `/admin/juridisk` siger det højt og tilbyder ingen tom CSV (ADR 0053) | Samtykketekst + kategori-liste (ejer); derefter en `consent_event`-tabel med RLS og en CSV-eksport. Må ikke stubbes (samtykke) | Ejer |
| `src/server/admin/subject-access.ts` (indsigtsudtræk) | **Modtagne vurderinger af en partner er udeladt** af partnerens udtræk, og udtrækket nævner det selv (`afgraensning`). Der er ingen persistent revisionslog over hvem der har hentet et udtræk — kun én logline uden persondata | Jura: må modtagne vurderinger med (evt. uden afgiver)? Plus en revisionstabel (migration + RLS) | Ejer / Mads |
| `docs/gdpr/sletteflow.md` | **Ingen admin-sletteaction findes.** Flowet er kun en skitse; `/admin/juridisk` henviser til det og siger at der ikke er en sletteknap. Destruktiv, kræver egen skive (ADR 0053) | Opbevaringspligt vs. sletning (bogføring, QuickPay/Nets-data), slette-SLA — ejer/jura; adaptere får `eraseDataSubject` | Ejer |
| `src/server/charges/` | Fejlet træk registreres (status + årsag) uden konsekvens for honorar eller adgang | §5.10 udløser honorar uafhængigt af betaling; koblingen er uafklaret (afledt af §12 pkt. 13) | Ejer |
| `src/server/charges/periods.ts`, `create.ts`, `sync.ts` | **Ingen proratering** ved op-/nedgradering midt i en 4-ugers periode: ændringen slår igennem ved næste periode, og den allerede oprettede opkrævning røres aldrig | Skal en ændring midt i perioden afregnes forholdsmæssigt? (ADR 0056; ikke besluttet) | Ejer |
| `membership.cancelled_at` (0020), webhook `membership_cancelled` | **Opsigelsen afskærer kun nye perioder** — intet opsigelsesvarsel, ingen refusion af den igangværende periode | Opsigelsesvarsel og hvad der sker med en betalt periode (ADR 0056; ikke besluttet) | Ejer |
| `src/server/charges/create.ts` | **Oversprungne perioder efterfaktureres ikke**: ligger kørslen stille ≥ 28 dage, oprettes kun indeværende periode | Skal en glemt periode opkræves bagud? Forretningsbeslutning — koden gætter ikke | Ejer |
| ~~`src/server/charges/webhook.ts`~~ | ~~Provisorisk payload-form~~ → **verificeret mod spec'en (ADR 0032)**: `Signature`-header, WebhookPayload-form, afledt event-id | Lukket 2026-08-04 | — |

## Bevidst tomme — ikke stubs

Til afgrænsning, så gennemgangen i fase 6 ikke leder efter dem:

- **Adgangsporten** (ADR 0020) er fuldt implementeret, blot ikke aktiveret — de tre
  `APP_GATE_*`-env-vars er ikke sat. Det er en driftstilstand, ikke en stub.
- **Dashboards** (fase 5.4, ADR 0055) er bygget. Hullerne i dem (partnerens ratings, lead-
  tildeling, PostHog-driftstatus) står i tabellerne ovenfor.
