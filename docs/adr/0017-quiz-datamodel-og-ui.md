# 0017 — Quiz-datamodel + admin-UI-tilgang (dependency-fri)

- **Status:** Accepteret
- **Dato:** 2026-07-22
- **Fase:** 1
- **Berører uafklaret punkt:** nej (tie-break-regler i matching er §12/1.5, ikke 1.2).

## Kontekst

Fase 1.2 er admin-forfatning af quizzen (byggespec §5.2/§6): to spørgsmål — Q1 kompetencer
(multi-valg; de 8 seedede `competence_tag` + en "Andre (fritekst)"-option der ikke er et tag) og
Q2 frekvens (enkelt-valg; uge-værdier 4/8/12, ikke tags). Admin skal kunne oprette/redigere/slette
spørgsmål, ændre rækkefølge, vælge enkelt-/multi-valg, mappe tags til options ("drag-n-drop"), og
preview inden gem. Ejer-flowet (1.3) og matching (1.5) læser senere schemaet.

To valg skal træffes: (a) datamodellen der rummer to heterogene spørgsmålstyper, og (b) hvordan de
tunge UI-dele (drag-n-drop + preview) bygges givet token-klasse-fundamentet uden UI-libraries (ADR 0002).

## Beslutning

**Datamodel** (`0007_quiz.sql`): tre tabeller + en option-kind-diskriminator.
- `quiz_question(kind single|multi, key, sort_order, is_published, …)` — draft/published så 1.3 kun ser published.
- `quiz_option(kind tag|free_text|frequency, frequency_weeks, sort_order, …)` — én tabel dækker alle option-typer; frekvens ligger inline (`frequency_weeks`, check-constraint), fritekst er egen type.
- `quiz_option_competence_tag(option, tag)` join — kun `tag`-options får rækker; det er hvad 1.5 matching konsumerer. Frekvens/fritekst har ingen tag-rækker (divergensen modelleres ved fravær, ikke ved nullable-tag-kolonner).
- RLS (ADR 0007, i migrationen): admin ser alt via `has_role('admin')`; authed ejer ser kun published; writes via service-role (ingen write-policy).

**UI-tilgang: dependency-fri** (jf. ADR 0002 "ingen tung component-library-afhængighed nu"; et dnd-/UI-library ville være et Spand-A-valg med egen ADR).
- **Rækkefølge**: `sort_order` + server-actions med tilgængelige op/ned-knapper som baseline (præcis `competence_tag`-mønsteret); native HTML5-drag lægges ovenpå som progressiv forbedring (PR 3), med op/ned som a11y-fallback. **Intet dnd-library.**
- **Tag-mapping**: token-stylet checkbox-picker pr. option (PR 2) — bedre UX end at trække tags.
- **Preview inden gem**: én præsentations-`QuizRenderer` (ejer-look, firkantet/flad) drevet af en quiz-data-prop; en tynd klient-preview-toggle fodrer den med det aktuelle draft (PR 3). Samme renderer genbruges i 1.3 → preview == produktion.
- Dette bliver appens første substantielle klient-interaktivitet ud over `AuthForm` — men det er ikke et library-valg, så ingen yderligere Spand-A-library-ADR er nødvendig.

**Levering i tre PR'er:** PR 1 schema + spørgsmåls-CRUD (op/ned-reorder) · PR 2 options + tag-mapping · PR 3 preview + drag-forbedring.

## Konsekvenser

- Positive: ét schema for begge spørgsmålstyper; forward-kompatibelt med 1.3/1.5; nul nye
  dependencies; drag/preview isoleret i senere PR'er; RLS + admin-guard dobbelt værn.
- Negative / pris: literal drag kræver håndrullet native HTML5 (a11y via op/ned-fallback); hvis
  ejerne vil have rigere drag (@dnd-kit), kræver det en ny ADR + dependency (bevidst udskudt).
- Opfølgning: matching-tie-break (§12) afklares i 1.5; fritekst-svar-lagring (ejerens faktiske
  fritekst-input) hører til 1.3-runtime, ikke 1.2-authoring.
