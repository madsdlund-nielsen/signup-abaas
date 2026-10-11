# 0059 — Mødeopsummering som gemt artefakt, genereret i baggrunden (`meeting_summary`)

- **Status:** Accepteret
- **Dato:** 2026-10-10
- **Fase:** 4 (4.4 AI-resumé, backlog B-45)
- **Berører uafklaret punkt:** ja — **note-synlighed** (§12 pkt. 16) og **samtykke til mødeoptagelse** (ejer); begge holdes restriktive/fejler lukket, ingen af dem besluttes her

## Kontekst

Opsummeringen af et afholdt møde blev bygget skærm-først (ADR 0042): `getMeetingSummary` kaldte
transskription og LLM ved **hver sidevisning** af `/moeder/[id]`. Det var fint mod demo-adapterne,
men med de rigtige Ordbogen-adaptere (ADR 0058) ville hver visning have startet en betalt,
synkron transskription af et 75-minutters møde plus en LLM-kørsel — minutter pr. visning, og et
nyt kald hver gang siden blev genindlæst. `docs/fase-4.md` §4.4 og ADR 0058 havde allerede
besluttet retningen (resumé gemmes i Supabase som mødeartefakt; generering i baggrunden); denne
ADR er selve datamodellen og kørslen. Flaget `FLAG_AIFOLLOWUP` måtte ikke tændes mod en rigtig
nøgle før dette var bygget.

Samtidig stod synlighedsreglen (kun boardets ejer) i siden, "fordi der endnu ikke findes en tabel
at lægge RLS på" (stub-registret). RLS er det primære autorisationslag (arkitekturprincip 5).

## Overvejede muligheder

**Hvor resuméet bor:**
- *Udbyderen er kilden (genopret ved læsning).* Dyrt, langsomt, og Supabase ville ikke længere
  være sandhedskilde for et mødeartefakt. Afvist.
- *Kolonner på `meeting`.* Blander livscyklus (ADR 0026) med AI-artefakt og giver ingen naturlig
  plads til kø-tilstand (forsøg, fejl). Afvist.
- *Egen tabel `meeting_summary`, én pr. møde.* **Valgt.**

**Hvordan generering køres:**
- *Server action ved et klik / ved sidevisning.* Samme problem som før: et betalt, langsomt kald
  bundet til en brugers request, og samtykket ville skulle tjekkes fra siden.
- *Database-trigger / køtjeneste.* Ny infrastruktur uden grund; repoet har allerede et
  cron-mønster.
- *Beskyttet cron-route + Netlify scheduled function*, præcis som `charge-periods` (ADR 0056).
  **Valgt.**

**Om transskriptet gemmes:**
- *Gem det rå transskript (til gen-opsummering).* Personfølsomt (hele mødets ordlyd), og ikke
  nødvendigt: resuméet er det ejeren skal bruge, og transskriptet kan genskabes fra optagelsen.
- *Gem det ikke.* **Valgt (dataminimering).** Tabellen har hverken en `transcript`-kolonne eller en
  `transcript_ref` (der er ingen lagring at pege på); en db-test sikrer at ingen kolonne med det
  navn dukker op.

## Beslutning

### Datamodel (migration `0022_meeting_summary.sql`)

`meeting_summary`: én række pr. møde (`meeting_id` **unique**, cascade med mødet — GDPR-sletteflowet).
`status` er enummet `afventer | genereres | klar | fejlet | mangler_samtykke | mangler_optagelse`;
`summary text`, `action_items jsonb` (kun arrays, check-constraint), audit `provider`/`model`,
`error` (kort fejlkode — aldrig leverandørtekst), `attempts`, `generated_at`, `created_at`,
`updated_at`. En `klar` række skal have resumé og tidspunkt (check-constraint).

**RLS: restriktiv default = boardets ejer + admin.** Partnere ser det **ikke** — heller ikke den
der sad i mødet. Det er reglen fra `/moeder/[id]` flyttet ned i RLS, som stub-registret forudsagde.
Udvidelse til partnerne er én policy (`is_partner_on_board`, som `meeting_agenda_item_select_partner`)
den dag ejeren afgør note-synlighed. **Ingen write-policies**: alle writes går via service-role —
baggrundskørslen og "Generér igen" bag ejerskabstjek.

### Generering (`src/server/summaries/generate.ts`)

`generatePendingSummaries(service, now, limit, deps)`:

1. **Køer** `afventer`-rækker for afholdte møder uden række (idempotent: unique + `ON CONFLICT DO NOTHING`).
2. **Samtykke** (`getRecordingConsent`) — `null` ⇒ `mangler_samtykke`; der hentes og sendes intet.
   **Optagelse** (`loadMeetingRecording`) — `null` ⇒ `mangler_optagelse`. Adapteren afviser desuden
   selv uden samtykke (to uafhængige led, ADR 0058); afvisningen mappes til samme tilstande uden at
   brænde et forsøg. `mangler_*` tjekkes igen ved hver kørsel (samtykke/optagelse kan komme
   senere), men skrives kun ved ændring.
3. **Lås** med en betinget update: `afventer → genereres` på `(id, status, attempts)` — kun én
   samtidig kørsel vinder (test med to samtidige kørsler: ét leverandørkald). En `genereres`-lås
   ældre end 30 min (`STALE_CLAIM_MS`, over 600 s + 120 s timeouts) kan overtages; forsøg tælles
   ved låsen, så en kørsel der dør hver gang opgives.
4. **Transskribér → opsummér → gem.** Fejl ⇒ `afventer` igen (prøves ved næste kørsel) indtil
   `MAX_ATTEMPTS` (3, teknisk grænse), derefter `fejlet` og en rapport til analytics. Kun mødets id
   og en kort fejlkode (`OrdbogenError:summarizeMeeting:HTTP502`) logges/gemmes — intet transskript,
   resumé eller persondata.

Ikke-konfigureret (en port er stub) ⇒ kørslen rører **ingen** rækker og brænder ingen forsøg; routen
svarer 503 (synligt hul).

### Demo (ADR 0041) — uden at stubbe samtykke

Samtykke-/optagelsestjekket springes **kun** over når **begge** porte er demo-adaptere
(`isDemoPath`): de har ingen lyd, sender intet nogen steder og returnerer faste `[DEMO]`-tekster,
så der er intet samtykke at tage stilling til. Er blot én port rigtig (eller stub), gælder tjekket
fuldt ud — en test beviser at en demo-transskription kombineret med en rigtig LLM stadig kræver
samtykke. Siden bevarer dagens demo-adfærd: er begge porte demo og der ingen `klar` række er,
bygges `[DEMO]`-resuméet direkte af demo-adapterne ved visning (gratis, uden at gemme noget),
så rejsen kan klikkes uden cron. Cron-kørslen kan også gemme et demo-resumé (`provider = 'demo'`).

### Kørsel

`/api/cron/summaries` er bygget som `/api/cron/charge-periods`: 503 uden `CRON_SECRET`, 401 ved
forkert hemmelighed (konstant-tid), no-op når `FLAG_AIFOLLOWUP` er slukket. Netlify scheduled
function `netlify/functions/summaries.ts` kalder den hvert 15. minut — en teknisk takt (kørslen er
idempotent og billig når der intet er at gøre; et resumé skal være der kort efter mødet), ikke en
forretningssats. Pr. kald behandles højst 3 møder (`DEFAULT_BATCH_LIMIT`).

### Siden

`/moeder/[id]` læser kun den gemte række (`getMeetingSummary` → `resolveSummaryState`) og viser
status roligt: på vej / mangler samtykke / mangler optagelse / kunne ikke laves (med "Generér
igen") / ikke konfigureret. "Generér igen" (`retryMeetingSummary`, kun `fejlet`, bag ejerskabstjek)
**genererer ikke selv** — den stiller rækken tilbage til `afventer` med nulstillede forsøg; kørslen
tager den, med samme samtykke-gate.

## Konsekvenser

- Positive: ingen betalte kald ved sidevisning; samtykke er ét sted (generatoren), ikke i siden;
  resuméet er et revisionsbart artefakt med audit (provider/model/forsøg); synlighed i RLS; ingen
  rå transskripter i basen.
- Negative / pris: opsummeringen er ikke øjeblikkelig (op til ca. 15 min efter at mødet er
  registreret afholdt); en tabel mere at slette i GDPR-flowet (løses af cascade).
- `LlmProvider` har fået et valgfrit `model` (audit); `OrdbogenLlmProvider` udfylder det.
- Kø-rækker oprettes af kørslen (ikke af mødets afholdelses-flip i `meetings/actions.ts`) — ingen
  kobling til mødemodulet.

## Åbent — flagget, ikke besluttet

- 🔴 **Samtykke til mødeoptagelse (ejer):** mekanismen findes ikke, så `getRecordingConsent` svarer
  `null` og alle rigtige resuméer ender som `mangler_samtykke`. Dette er tilsigtet.
  `// TODO(ejer): samtykke til mødeoptagelse`.
- **Note-synlighed (ejer, §12 pkt. 16):** restriktiv default i RLS. `// TODO(ejer): note-synlighed`.
- `// TODO(mads)`: Netlify begrænser kørselstiden for en scheduled function/route. Tre møder pr. kald
  og én rigtig 75-minutters transskription kan overskride den — verificér med en rigtig nøgle; fald-
  back er en Netlify Background Function (15 min) der kalder samme generator.
- `// TODO(mads)`: `enqueueMissing` bruger PostgREST's embed-filter (`meeting_summary=is.null`) til at
  finde afholdte møder uden række; det er testet mod en dobbelt (og filtreres defensivt i koden), men
  ikke kørt mod en rigtig PostgREST.
- Cal.com-optagelsen (`loadMeetingRecording`, spike L-8) er stadig et hul; indtil den er klar ender
  rigtige møder i `mangler_optagelse` (efter samtykke).

## Opdatering (2026-10-11) — sikkerhedsreview

"Generér igen" kan kun nulstille en `fejlet` række der har ligget i mindst 15 minutter
(`RETRY_COOLDOWN_MS`). Hvert gennemløb kan koste op til `MAX_ATTEMPTS` betalte leverandørkald, så
uden bremsen kunne en ejer nulstille i en løkke. Bremsen er teknisk, ikke en forretningsregel.
