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
- [ ] Notifikationsmotor: e-mail via **Resend (EU)**, SMS via **inMobile** — begge
      porte findes allerede i `src/lib/email/` og `src/lib/sms/`.
- [ ] Admin kan redigere notifikationsskabeloner **med live preview**.
- [ ] Visuel markering i admin når en ændring er live.
- [ ] Notifikationer dækker minimum: mødepåmindelse, aflysning/flytning,
      ratinganmodning, fejlet betaling (fra fase 3).
- [ ] Fuld test suite grøn, inkl. RLS på ratings, resuméer og forberedelsesnoter
      (positive **og** negative cases).

## Status (2026-08-27)

**4.1 og 4.2 er bygget** — de eneste dele af fasen der ikke kræver en leverandørkonto.
Migration `0015_preparation_and_rating.sql`, `src/server/preparation/`, `src/server/ratings/`,
forberedelsesrummet på `/moeder/[id]` og admin-visningen på `/admin/vurderinger`. Datamodel og
de tre synlighedsregimer er begrundet i **ADR 0038**.

Udestår i 4.2: **signerede engangslinks** (B-21) — bevidst udskudt til 4.5, som er den der
udsender dem.

**4.3–4.6 er ikke startet** og bør ikke startes for at producere stubs (fase 3-rapporten §8):
Ordbogen-DPA er uunderskrevet, samtykke til optagelse er ejer-uafklaret, og der findes hverken
Resend- eller inMobile-konto.

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
- Resumé gemmes i Supabase som mødeartefakt, ikke kun hos udbyderen.
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

- Ordbogen DPA/databehandleraftale — dækker både transskription og LLM (Mads).
- Samtykke til mødeoptagelse (ejer) — blokerer 4.3 og 4.4 i produktion.
- Note-synlighed, inkl. resuméer (ejer).
- Noter under møde (ejer).
- Hvad ratings må bruges til (ejer) — byg data, ikke automatik.

## Bygges IKKE i fase 4

- Honoraropgørelse/udbetaling (fase 5).
- Partner-tilgængelighed og dashboards (fase 5).
- Tie-break-logik baseret på rating (uafklaret — se 4.2).
- In-app messaging — **hele modulet er uafklaret**, byg ikke.
