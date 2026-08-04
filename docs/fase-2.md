# Fase 2 — Booking & video

> Mål: et etableret board kan booke, afholde, flytte og aflyse møder i appen.
> Cal.com er kilden til kalender/booking, Cal Video er mødelokalet, og Supabase
> holder mødets forretningstilstand. Forudsætter at fase 1 er grøn.
> Læs `CLAUDE.md` først.
>
> **Bemærk (2026-08-03):** dokumentet er tilpasset repoets faktiske tilstand — tabelnavne
> i ental (ADR 0006), eksisterende leverandørneutrale porte (ADR 0004), og partner-login
> skrevet ind som 2.8, da det er sporet i CLAUDE.md's fase 2 (ADR 0019/0021).

## Leverancekriterier (Definition of Done for fase 2)

- [ ] Cal.com integreret via adapteren i `src/lib/booking/` (Platform managed users +
      Atoms) — **ingen direkte SDK-kald uden for adapteren**.
- [ ] Multi-host booking virker: 2-3 partnere + ejer på samme møde.
      ⚠ **Blokeret indtil multi-host-spiken er kørt** — se 2.2.
- [ ] Webhooks fra Cal.com → `meeting` i Supabase (oprettet, flyttet, aflyst,
      afholdt). Idempotent og signaturverificeret.
- [ ] Møde varer 60 min + **15 min betalt forberedelse** afspejlet i
      datamodellen (honorargrundlag = 75 min).
- [ ] Cal Video som mødelokale, link tilgængeligt for alle deltagere i appen.
- [ ] Mødestatus-livscyklus i app: planlagt → afholdt / aflyst / udeblevet.
- [ ] Booking, flytning og aflysning kan udføres i appen — ikke kun i Cal.com.
- [ ] Møde-noter (efter møde) kan oprettes og læses jf. rolleadgang via RLS.
- [ ] Lead-partner ser og kan initiere **næste møde** for sit board.
- [ ] **Partner-login + self-service-profil** (2.8): partner kan logge ind, se sit
      board og redigere egen profil — men **ikke** egne kompetence-tags.
- [ ] Fuld test suite grøn, inkl. webhook-integrationstests og RLS-policy-tests
      på `meeting` og noter (positive **og** negative, jf. `tests/CLAUDE.md`).

## Arbejdspakker

> **Rækkefølge:** 2.8 er den eneste pakke der ikke afhænger af en Cal.com-konto, og
> den lukker en åben regression fra fase 1. Byg den først, mens spiken afventer.

### 2.1 Cal.com-adapter
- Udfyld den eksisterende port i `src/lib/booking/` med et snævert domænevendt
  interface (opret booking, flyt, aflys, hent deltagere).
- Mappen er bevidst leverandørneutral (ADR 0004) — **læg ikke `calcom` i stien**;
  self-host er dokumenteret exit, og adapteren skal kunne skiftes uden at flytte kode.
- Ingen Cal.com-typer må lække ud af adapteren — mappes til egne domænetyper.
- Aktiveres af `FLAG_BOOKING` + `CALCOM_API_KEY`; uden dem forbliver stubben aktiv
  (`docs/stub-politik.md`).

### 2.2 Multi-host booking 🚩 blokeret
- Implementér booking med 2-3 partnere + ejer som deltagere på ét møde.
- ⚠ **Spiken er aldrig kørt.** `docs/spikes/multi-host.md` er forberedt, men kræver en
  Cal.com-konto. Der findes derfor **ingen ADR med en multi-host-konklusion** — den
  skrives når spiken køres, og først da kan denne pakke bygges færdig.
- Afdækker spiken en blokering: byg bag feature-flag og flag det — improvisér ikke.

### 2.3 Webhooks → Supabase
- Modtag Cal.com-webhooks; verificér signatur; afvis ikke-verificerede.
- **Idempotens er et krav** — samme event må ikke skabe dublet-møder.
- Skriv til `meeting` som sandhedskilde for forretningstilstand (Supabase
  vinder over Cal.com på status, honorar og noter).
- Log webhook-fejl gennem `src/lib/analytics/` (PostHog, fase 0).
- **Hverken signaturverifikation eller idempotens må stubbes** — se `docs/stub-politik.md`.

### 2.4 Datamodel for møder
- Ny migration (næste ledige nummer efter `0010`). Navnekonvention pr. ADR 0006:
  **ental, snake_case**, FK som `<tabel>_id`.
- `meeting`: board, starttid, varighed (60+15), status, video-link, Cal.com-reference.
- `meeting_participant`: deltagerroller pr. møde (ejer, partner, lead-partner) —
  grundlag for RLS.
- RLS-policies hører i **samme migration** som tabellen (ADR 0007), med negative tests.
- Honorargrundlag registreres på mødet, men **beregning/udbetaling hører til
  fase 5** — byg feltet, ikke logikken.
- ⚠ Deltager-referencen skal følge ADR 0021: partnere identificeres via
  `partner_profile`, ikke `app_user`, indtil 2.8 kobler de to.

### 2.5 Cal Video
- Cal Video som primært mødelokale (RealtimeKit udgår, jf. `CLAUDE.md`).
- Udfyld porten i `src/lib/video/`; aktiveres af `FLAG_VIDEO` + `CALVIDEO_API_KEY`.
- Videolink eksponeres i appen for alle mødedeltagere, aldrig offentligt.
- ⚠ Optagelse: Cal.com er ansvarlig for optag, men **plan/EU-residens og
  samtykke er uafklaret** — byg ikke optagefunktion uden beslutning.

### 2.6 Booking-UI (ejer + lead-partner)
- Book, flyt og aflys i appen. Brug Cal.com Atoms hvor det giver mening, men
  stylet med design-tokens — firkantet, navy/guld, Open Sans.
- Lead-partner kan initiere næste møde for sit board.
- ⚠ Ændre/aflyse-vindue er uafklaret → læg reglen bag konfiguration + flag,
  hardcod ikke et vindue.

### 2.7 Mødestatus & noter
- Statusovergange med tydelig UI-tilstand.
- Noter efter møde, med adgang styret af RLS.
- ⚠ Note-synlighed og noter *under* møde er uafklaret → byg efter-møde-noter
  med restriktiv default (kun boardets deltagere) bag flag.

### 2.8 Partner-login + self-service-profil
> Udskudt fra 1.4 (ADR 0019) og sporet hertil i `CLAUDE.md`. **Ikke blokeret af
> Cal.com** — byg denne først.

- Auth-bruger-oprettelse/-invitation for partnere. `provisioning.ts` provisionerer i
  dag kun `ejer` — udvid med partner-rollen.
- Kobl katalogpost ↔ auth-bruger: tilføj `partner_profile.app_user_id`.
- **Genopliv `board_select_partner`** via den kobling. Policyen blev fjernet i migration
  `0010`, fordi `board_partner.partner_id` peger på en katalogpost uden auth-konto
  (ADR 0021) — konsekvensen er at partnere lige nu **ikke kan se deres eget board**.
- Partner-ruter + self-service-redigering af egen profil. **Kompetence-tags forbliver
  admin-styret** — ingen partner-write-policy på `partner_profile_competence_tag`.
- Negative RLS-tests: en partner må ikke kunne redigere egne tags, ikke se andres
  board, og ikke se andre partneres profiler ud over sit eget board.

## Uafklarede punkter berørt i fase 2 (flag, beslut ikke)

- Ændre/aflyse-vindue inden møde (ejer).
- Samtykke til mødeoptagelse (ejer) + Cal.com-optagelse på valgt plan (Mads).
- Cal.com EU-residens på valgt niveau (Mads) — verificér før produktionsbrug.
- Cal.com multi-host-spike (Mads) — **blokerer 2.2**.
- Note-synlighed: hvem ser møde-noter (ejer).
- Noter under møde (ejer).
- Honorar ved udeblivelse/sent afbud (ejer) — påvirker statusmodellen; registrér
  `udeblevet` som status, men beregn ikke konsekvens.
- Board-livscyklus (ejer) — hold `meeting` livscyklus-agnostisk indtil afklaret.
- Lead-partner: tildelings-/rotationsregler (ejer) — 2.6 hviler på hvem der er lead.

## Bygges IKKE i fase 2

- Betaling, prisberegner, Alunta (fase 3).
- Forberedelse, rating, AI-resumé, transskription, notifikationer (fase 4).
- Honoraropgørelse/udbetaling, tilgængelighed, dashboard (fase 5).
- In-app messaging — **hele modulet er uafklaret**, byg ikke.
