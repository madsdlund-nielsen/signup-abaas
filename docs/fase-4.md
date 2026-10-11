# Fase 4 — Forberedelse, rating, AI & notifikationer

> Mål: mødet får værdi før og efter — ejer og partnere forbereder sig struktureret,
> møder opsummeres automatisk, deltagere rater, og alle får rettidige beskeder.
> Forudsætter at fase 3 er grøn. Læs `CLAUDE.md` først.
>
> **Advarsel:** transskription og auto-resumé er ikke blokeret af dataresidens længere
> — Ordbogen er dansk hele vejen (ADR 0024) — men **DPA'en udestår**, og samtykke til
> optagelse er stadig ejer-uafklaret. Byg bag feature-flag; sæt intet i produktion
> før begge dele er på plads.
>
> **Bemærk (2026-08-03):** tilpasset repoet — porte og flag peger på de eksisterende
> (`src/lib/transcription/`, `src/lib/llm/`, `src/server/flags`).

## Leverancekriterier (Definition of Done for fase 4)

- [x] Forberedelsesmodul: ejer kan forberede dagsorden/spørgsmål inden mødet. **(2026-08-27, ADR 0038)**
- [x] De **15 minutters betalte forberedelse** for partnere er understøttet med
      et sted at forberede sig (kobling til honorargrundlag fra fase 2). **(2026-08-27)**
- [x] Rating efter møde: deltagere kan vurdere mødet; resultat gemt i Supabase.
      **(2026-08-27 — men signerede engangslinks mangler, se B-21)**
- [ ] Transskription via **Ordbogen (ordbogen.ai)** bag `FLAG_TRANSCRIPTION` — flaget
      tændes når DPA og samtykkeflow er på plads.
- [ ] Auto-resumé af møde via **Ordbogen (Odin-LLM)** bag `FLAG_AIFOLLOWUP`.
- [x] Notifikationsmotor: e-mail via **Resend (EU)**, SMS via **inMobile** — begge
      porte findes allerede i `src/lib/email/` og `src/lib/sms/`. **(Oversigtsskærmen
      2026-09-21, ADR 0048; motor, adaptere, idempotent udsendelseslog, retry og fejlrapportering
      2026-10-10, ADR 0057.)** ⚠ Forbehold for nøgler: Resend-adapteren og inMobile-adapteren er
      skrevet men aldrig kørt mod en konto (inMobile desuden mod bedste forståelse af API'et,
      `TODO(mads)`); begge er stubs/demo indtil konti, nøgler og flag lander.
- [x] Admin kan redigere notifikationsskabeloner **med live preview**.
      **(2026-10-10, `/admin/notifikationer/[type]`, ADR 0057.)**
- [x] Visuel markering i admin når en ændring er live. **(2026-10-10: LIVE/UDKAST-mærker,
      advarsel når udkast afviger fra live, to-trins publicering, versionshistorik.)**
- [ ] Notifikationer dækker minimum: mødepåmindelse, aflysning/flytning,
      ratinganmodning, fejlet betaling (fra fase 3). **(Delvist: aflysning/flytning er koblet
      på `rescheduleMeeting`/`cancelMeeting`. Påmindelse og ratinganmodning er bygget som
      «find de skyldige + send», men sender intet før ejeren har fastsat tidspunkterne og ruten
      `/api/cron/notifications` er planlagt. Fejlet betaling sendes fra Alunta-webhooken når et
      træk skifter til `fejlet` (B-41). Ingen skabelontekst er skrevet.)**
- [ ] Fuld test suite grøn, inkl. RLS på ratings, resuméer og forberedelsesnoter
      (positive **og** negative cases).

## Status (2026-08-27)

**4.1 og 4.2 er bygget** — de eneste dele af fasen der ikke kræver en leverandørkonto.
Migration `0015_preparation_and_rating.sql`, `src/server/preparation/`, `src/server/ratings/`,
forberedelsesrummet på `/moeder/[id]` og admin-visningen på `/admin/vurderinger`. Datamodel og
de tre synlighedsregimer er begrundet i **ADR 0038**.

Udestår i 4.2: **signerede engangslinks** (B-21) — bevidst udskudt til 4.5, som er den der
udsender dem.

**4.3–4.6 bygges skærm-først** siden 2026-09-14 (ADR 0042) mod demo-adapterne (ADR 0041):
skærmen først, så Mads kan klikke og designe; leverandøren droppes ind når Ordbogen-nøglerne
(konto bestilt 2026-09-15), samtykke til optagelse og Resend-/inMobile-konti lander. Den
tidligere anbefaling om ikke at starte før konti findes (fase 3-rapporten §8) er trukket tilbage.

**4.4 er startet 2026-09-15:** opsummeringsskærmen på `/moeder/[id]` (`src/server/summaries/`,
`MeetingSummary`) viser referat + handlingspunkter for et afholdt møde — kun for ejeren
(restriktiv default, §4.4). Datakilden går gennem portene ved læsning; persistens som
mødeartefakt, generér-handling og samtykke-gate følger når Ordbogen lander. 4.3, 4.5 og 4.6
udestår.

**4.5/4.6 er startet 2026-09-21:** notifikationsoversigten på `/admin/notifikationer`
(`src/server/notifications/`, `NotificationOverview`) viser de fire påkrævede beskedtyper og
den faktiske tilstand pr. kanal — e-mail og SMS er begge stubs i dag, og skærmen siger det
frem for at love noget. Kataloget står i kode indtil skabelonerne får en tabel (**ADR 0048**);
skabelontekst er hverken skrevet eller stubbet.

**4.5/4.6 er bygget 2026-10-10 (ADR 0057):** migration `0021_notification_template.sql`
(versionerede skabeloner med atomisk publicering + udsendelseslog uden persondata), ren rendering
(`src/server/notifications/render.ts`), admin-editoren `/admin/notifikationer/[type]` med live
preview og LIVE/UDKAST-markering, motoren (`engine.ts`: reservér → live skabelon → render → send
med retry → log → analytics), Resend- og inMobile-adaptere og e-mail/SMS-demo. Aflysning/flytning
er koblet på møde-handlingerne. **Udestår:** konti og nøgler (adaptere aldrig kørt live — inMobile
er desuden uverificeret), ejerens udsendelsestidspunkter (så planlagte beskeder ikke sendes og
ruten ikke er planlagt), skabelonteksten, SMS-samtykketeksten (telefonnummer + opt-in findes nu på `/konto`, ADR 0061 — SMS sendes kun til dem der har krydset af). Signerede engangslinks til rating (B-21) er stadig ikke bygget.

**4.3/4.4 — Ordbogen-adapterne er bygget 2026-10-10 (ADR 0058)** mod OdinCores offentlige
OpenAPI-spec (`docs/spikes/ordbogen-api.md`): `src/lib/llm/ordbogen.ts` (`/v1/chat/completions`,
struktureret JSON-resumé) og `src/lib/transcription/ordbogen.ts` (`/v1/audio/transcriptions`,
synkront multipart), på en fælles klient. **Adapter bygget, afventer nøgle** — DoD-punkterne
ovenfor er derfor stadig ikke afkrydset: intet er kørt mod Ordbogen, og modelnavne, grænser og
API'ets dataresidens er uverificerede (`TODO(mads)`). Transskription **fejler lukket** uden
registreret samtykke til optagelse (ejerens punkt; mekanismen findes ikke —
`src/server/consent/recording.ts`) og kræver desuden at Cal.com-optagelsen kan hentes (L-8).
**Resuméet gemmes nu som mødeartefakt og genereres i baggrunden (ADR 0059, B-45 lukket):** migration
`0022` (`meeting_summary`, RLS boardets ejer + admin), `generatePendingSummaries` bag samtykke-gaten,
`/api/cron/summaries` + Netlify scheduled function (hvert 15. min), og `/moeder/[id]` læser den gemte
række (status: på vej / mangler samtykke / mangler optagelse / fejlet + "Generér igen"). Rigtige
møder ender indtil videre som `mangler_samtykke` (ejerens punkt) / `mangler_optagelse` (L-8).

⚠ Db-testene for 0015 er **ikke kørt lokalt** — Docker mangler på maskinen (B-13). CI er eneste
gate for denne migrations RLS.

## Arbejdspakker

### 4.1 Forberedelsesmodul
- Ejer: dagsorden, spørgsmål, materiale inden mødet.
- Partner: forberedelsesrum svarende til de 15 betalte minutter.
- Adgang styret af RLS: kun boardets deltagere. Policies i samme migration som
  tabellen (ADR 0007), ental-navngivning (ADR 0006).
- Forudsætter partner-login fra fase 2.8 — uden det har partneren ingen indgang.

### 4.2 Rating
- Rating efter afholdt møde (kobling til mødestatus fra fase 2).
- Simpelt, hurtigt format — det skal kunne besvares på under et minut.
- Signerede engangslinks frem for åbne endpoints (byggespec §8).
- Aggregering pr. partner er **datagrundlag**, ikke en offentlig score. ⚠ Hvad
  ratings bruges til (matching? udskiftning?) er ikke besluttet → byg lagring
  og visning for admin, ikke automatisk konsekvens.
- Bemærk: rating er et af de kandidater byggespec §5.2 nævner som mulig
  **tie-break** i board-matchingen. Den kobling må ikke bygges her — tie-break-reglen
  er stadig uafklaret (se `docs/fase-1-rapport.md`).

### 4.3 Transskription 🚩 flag
- ✅ **Ordbogen (ordbogen.ai)** — dedikeret tale-til-tekst-model, dansk hosting (ADR 0024).
- Udfyld porten i `src/lib/transcription/`; udbyderen forbliver udskiftelig (ADR 0004).
- ⚠ **DPA udestår (Mads).** Dansk hosting er ikke i sig selv en databehandleraftale.
- ⚠ Samtykke til optagelse er uafklaret (ejer) — transskription må **ikke**
  aktiveres uden samtykkeflow, uanset at leverandøren er dansk. **Samtykke må aldrig
  stubbes** (`docs/stub-politik.md`).

### 4.4 Auto-resumé (LLM) 🚩 flag
- Udfyld porten i `src/lib/llm/` mod **Ordbogen (chat.dk / Odin-LLM)** — dansk model,
  dansk datacenter, hele værdikæden i Danmark (ADR 0024).
- ⚠ Samme DPA som 4.3 — én leverandør, én aftale. Skal foreligge før produktionsbrug.
- Resumé gemmes i Supabase som mødeartefakt, ikke kun hos udbyderen. ✅ `meeting_summary` (ADR 0059).
- ⚠ Note-synlighed (ejer) gælder også resuméer → restriktiv default.

### 4.5 Notifikationsmotor
- Resend (EU) til e-mail, inMobile til SMS. Begge porte findes; udfyld adapterne.
- Skabeloner som data, ikke kode.
- Retry og fejllogning via `src/lib/analytics/` (PostHog).

### 4.6 Admin: skabeloner med live preview
- Rediger notifikationsskabeloner med **live preview** (eksplicit krav).
- **Visuel markering når en ændring er live** (eksplicit krav) — admin skal aldrig
  være i tvivl om, om noget er udkast eller i produktion.

## Uafklarede punkter berørt i fase 4 (flag, beslut ikke)

- ~~Ordbogen DPA/databehandleraftale~~ → **håndteret uden for repoet** (Mads, 2026-09-15).
  Konto er bestilt; 4.3/4.4 venter nu kun på nøgler — og på samtykke nedenfor.
- Samtykke til mødeoptagelse (ejer) — blokerer 4.3 og 4.4 i produktion.
- Note-synlighed, inkl. resuméer (ejer).
- Noter under møde (ejer).
- Hvad ratings må bruges til (ejer) — byg data, ikke automatik.

## Bygges IKKE i fase 4

- Honoraropgørelse/udbetaling (fase 5).
- Partner-tilgængelighed og dashboards (fase 5).
- Tie-break-logik baseret på rating (uafklaret — se 4.2).
- In-app messaging — **hele modulet er uafklaret**, byg ikke.
