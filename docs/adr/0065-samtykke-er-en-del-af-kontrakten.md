# 0065 — Samtykke er en del af kontrakten: ingen opt-in/out på platformen

- **Status:** Accepteret
- **Dato:** 2026-10-11
- **Fase:** 4 (4.3 transskription, 4.4 AI-resumé, 4.5 SMS) + 5 (5.4 lead-aflæsning, 5.5 juridisk interface)
- **Berører uafklaret punkt:** ja — lukker «Samtykke til mødeoptagelse»; ToS og honoraraftalens
  **indhold** er stadig ejerens (kontrakten skal skrives). Cookie-samtykket til analytics er en
  **bevidst undtagelse** og afventer Mads' afgørelse (se nedenfor).
- **Delvist erstatter:** 0058 (samtykke fejler lukket — hullet er nu lukket, værnet bevares),
  0059 (`mangler_samtykke` betyder nu «intet grundlag»), 0061 (SMS-samtykket), 0055 (spørgsmålet
  om at informere ejeren om lead-aflæsningen).

## Kontekst

Tre moduler stod og ventede på en samtykkemekanisme ejeren ikke havde besluttet:

1. **Mødeoptagelse og AI-behandling.** `getRecordingConsent` svarede altid `null`, så
   transskription og resumé af rigtige møder endte i `mangler_samtykke` (ADR 0058, 0059).
2. **SMS.** Kontoprofilen havde en eksplicit afkrydsning `sms_opt_in` med tidspunkt og en
   check-constraint (migration 0024, ADR 0061); SMS gik kun til dem der havde krydset af.
3. **Lead-aflæsningen.** Spørgsmålet om ejeren skal informeres om at boardets lead ser
   kompetencebehovet (ADR 0055) hang på ToS.

**Beslutning (Mads, 2026-10-11, ordret):** «Alle samtykker ift GDPR, ai og hvad vi ellers har
hængende er en del af kontrakt indgåelsen. Der skal ikke være yderligere levers på platformen til
at opt in eller out.»

## Beslutning

Samtykke til mødeoptagelse, AI-behandling (Ordbogen), SMS og lead-partnerens aflæsning er en del
af **kontraktindgåelsen** (ToS + honoraraftale). Platformen har ingen tabel, ingen UI og ingen
tilbagekaldelse til dem. Retsgrundlaget i koden er kontrakten.

### Hvad der ændres

- **`getRecordingConsent(meetingId)`** returnerer `{ meetingId, basis: "kontrakt" }` for et møde
  der findes på platformen (opslag i `meeting` med service-role; det er server-only), og `null` for
  et ukendt møde eller en læsefejl. `RecordingConsent` mistede `registeredAt` (der er ingen
  registrering) og fik `basis: "kontrakt"`, så grundlaget er eksplicit og kan udvides.
- **Migration `0027_contract_consent.sql`** dropper `app_user.sms_opt_in`, `sms_opt_in_at` og
  check-constraintet `app_user_sms_opt_in_consistent` (`if exists`, idempotent). Telefonnummer,
  navn og tidszone består. Data i de to kolonner går tabt med vilje.
- **SMS** sendes når brugeren har et telefonnummer; ellers logges `fejlet: intet telefonnummer`
  (`NO_PHONE_REASON`, tidligere `NO_SMS_CONSENT_REASON`).
- **`/konto`** mistede afkrydsningen og samtykketeksten; telefonfeltet består. `parseProfileInput`
  og `saveAccountProfile` kender ikke længere et samtykke (`smsConsentStamp` er slettet).
- **Indsigtsudtrækket** (`/admin/juridisk`) har ikke længere `person.sms_samtykke`; `samtykke`-blokken
  og afgrænsningen siger at optagelse, AI og SMS er kontraktens og ikke registreres pr. person.
- **Lead-aflæsningen** (ADR 0055): spørgsmålet «skal ejeren informeres?» er lukket — det er
  dækket af kontrakten.

### Hvad der bevares som værn (defense-in-depth)

- Adapteren `OrdbogenTranscriptionProvider` kræver stadig et `consent`-objekt for netop dette møde
  og kaster `RecordingConsentMissingError` uden. Generatoren tjekker `getConsent` før lyden hentes.
  De to uafhængige led (ADR 0058) består; de leveres nu bare af `getRecordingConsent`.
  Fejlmeddelelsen siger «intet grundlag (kontrakt)» frem for «intet samtykke».
- `mangler_samtykke` (enum i `meeting_summary`, 0022) består uomdøbt — en omdøbning kræver en
  migration uden gevinst. Betydningen er nu «intet grundlag for mødet» (et ukendt møde), og
  statusteksten på `/moeder/[id]` er rettet derefter.
- Transskription er stadig bag `FLAG_TRANSCRIPTION` + nøgle, og demo-stien (ADR 0041) er uændret.
- **Selve optagelsen er stadig et hul:** `loadMeetingRecording` (spike L-8, Cal.com-optagelse på
  Teams) returnerer `null`, så rigtige møder ender i `mangler_optagelse`. Dette ændrer beslutningen
  ikke.
- Sletteflowet og leverandør-registeret er uændret i substans: optagelser slettes hos Cal Video
  og telefonnummeret hos inMobile; retsgrundlaget er nu kontrakten.

### Bevidst undtagelse: cookie-samtykket til analytics

`src/server/consent/index.ts` og banneret er **ikke rørt**. Besøgende **før** de har indgået en
kontrakt er ikke dækket af den, og cookiereglerne kræver samtykke til analytics-cookies uanset
en kontrakt. Banneret er derfor stadig et opt-in-håndtag. **Afgørelsen er Mads'** — undtagelsen
står her, så den er en bevidst afvigelse fra «ingen levers» og ikke en glemt rest.

**Afgjort (Mads, 2026-10-11): cookie-banneret bliver.**

## Konsekvenser

- Positive: tre blokeringer er væk (optagelses-/AI-samtykke, SMS-samtykketekst, lead-information);
  mindre kode og færre tilstande (ingen samtykketabel, tilbagekaldelse eller historik at bygge);
  en simpel, forståelig model for ejeren.
- Negative / pris: **ingen enkeltperson kan sige nej** uden at opsige kontrakten. Det er et
  juridisk og produktmæssigt valg, ikke et teknisk. Kontraktens ordlyd bærer nu hele vægten.
- Åbne punkter (ejerens, ikke Claude Codes):
  - `TODO(ejer)`: ToS og honoraraftalen skal skrives så de dækker samtykke til mødeoptagelse,
    AI-behandling (Ordbogen), SMS og at boardets lead ser ejerens kompetencebehov. Det gælder
    **begge sider**: ejeren (ToS) og partneren (honoraraftalen) deltager i de optagne møder.
  - `TODO(ejer)`: skabelonteksterne til SMS/e-mail forudsætter stadig ToS (ADR 0057).
  - ~~Afgør om cookie-samtykket til analytics fortsat skal være et opt-in-banner~~ → **ja, banneret bliver** (Mads, 2026-10-11).
  - `TODO(mads)`: bekræft at kontrakten er et tilstrækkeligt retsgrundlag for optagelse af
    **partnere** og for AI-behandling af mødeindholdet (databehandleraftalen med Ordbogen er
    håndteret uden for repoet, ADR 0024) — og at kontrakten indgås **før** det første møde.
- Reversibilitet: genindførsel af et håndtag er en ny migration og en ny ADR; `RecordingConsent`
  er allerede en typet kerne, så værnet i adapteren kræver ingen ændring.
