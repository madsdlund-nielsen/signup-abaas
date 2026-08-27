# 0038 — Forberedelse og rating: datamodel og synlighedsregimer

- **Status:** Accepteret
- **Dato:** 2026-08-27
- **Fase:** 4
- **Berører uafklaret punkt:** ja — *note-synlighed* og *hvad ratings bruges til* (begge ejer).
  Begge er markeret med `TODO(ejer)` i migrationen og løst med den restriktive mulighed, ikke
  med et gæt.

## Kontekst

Fase 4.1 (forberedelsesmodul) og 4.2 (rating) er de eneste dele af fase 4 der ikke er
konto-blokerede: de kræver hverken Ordbogen-DPA, Resend eller inMobile. Fase 3-rapportens §8
advarede mod at starte fase 4 "for at producere stubs" — 4.1 og 4.2 producerer ingen stubs,
og bygges derfor nu, mens 4.3–4.6 venter på konti og aftaler.

Datamodellen skal svare på tre spørgsmål som byggespec ikke afgør entydigt:

1. **Hvem ser hvad?** Forberedelse og vurderinger er følsomme på hver sin måde. `meeting_note`
   (0012) valgte allerede en restriktiv default med henvisning til det uafklarede punkt
   *note-synlighed*; de nye tabeller skal forholde sig til samme punkt.
2. **Hvordan repræsenteres en "rater"?** Både ejeren og partnerne vurderer, men de er ikke
   samme slags entitet: ejeren er en auth-bruger, partneren er en katalogpost (ADR 0021).
3. **Skal vurderinger have konsekvenser?** Byggespec §5.2 nævner rating som mulig tie-break i
   board-matchingen, men reglen er uafklaret (B-07).

## Overvejede muligheder

**Synlighed for partnerens forberedelsesnote:**
- **Som `meeting_note`** (forfatter + boardets ejer + admin) — konsistent med naboen, men
  antager at ejeren har krav på at læse partnerens interne forberedelse.
- **Kun forfatter + admin** — snævrere end naboen, kræver en forklaring, men kan udvides med
  én policy hvis ejeren beslutter det. Det omvendte — at inddrage adgang folk allerede har
  fået — er langt dyrere.

**Rater-identitet:**
- **To tabeller** (`meeting_rating_owner`, `meeting_rating_partner`) — typerent, men to sæt
  RLS-policies, to indexes og en union hver gang der aggregeres.
- **Én tabel med to nullable kolonner + check-constraint** — én policy-flade, og
  "præcis én identitet" håndhæves i basen frem for i koden.

**Aggregering pr. partner:**
- **Database-VIEW** — tættere på data, men en view skal bære sin egen RLS-historik for at
  være sikker, og en fejl dér er en stille datalækage.
- **TypeScript over RLS-scopede rækker** — autorisationen ligger ét sted (tabellens policies),
  og funktionen kan unit-testes uden database.

## Beslutning

**Tre tabeller i migration `0015_preparation_and_rating.sql`, med tre bevidst forskellige
synlighedsregimer:**

| Tabel | Synlighed | Begrundelse |
|---|---|---|
| `meeting_agenda_item` | **DELT** — ejer, partner på boardet, admin | Dagsordenen er hele grunden til at partneren kan forberede sig. Uden delt synlighed har modulet ingen funktion. |
| `meeting_prep_note` | **PRIVAT** — forfatter + admin | Partnerens eget arbejdsrum. Ejeren er bevidst udeladt. |
| `meeting_rating` | **PRIVAT** — den der afgav vurderingen + admin | Den vurderede ser ikke sin egen score. |

**Forberedelsesnoten er snævrere end `meeting_note`, og det er tilsigtet.** En efter-møde-note
er en leverance til ejeren; en forberedelsesnote er partnerens kladde. Forskellen er ægte, og
når *note-synlighed* stadig er ejer-uafklaret, er den restriktive mulighed den eneste der kan
omgøres uden at have lækket noget først.

**Rating: én tabel, to nullable rater-kolonner, check-constraint.** `subject_partner_profile_id`
er null når vurderingen gælder mødet som helhed, og sat når den gælder en enkelt rådgiver — det
er den kolonne aggregeringen læser. Unikheden bruger **`unique nulls not distinct`** (PG 15+;
prod kører 17, testcontaineren 16): uden den ville to møde-vurderinger fra samme rater tælle
som forskellige rækker, og gentagne indsendelser ville hobe sig op frem for at opdatere.

**Vurderinger har ingen konsekvens i koden.** Matching-algoritmen læser ikke `meeting_rating`,
og admin-siden viser tal uden handlinger. Tie-break-reglen er ikke vores at træffe (B-07).

**Writes går via service-role bag eksplicitte tjek** (mønster fra 0012). Tre regler håndhæves
i `src/server/ratings/actions.ts`, fordi ingen af dem kan være en check-constraint: mødet skal
være **afholdt**, raten skal selv være knyttet til mødet, og et partner-subjekt skal have
deltaget. Berettigelse udledes af **relationen til mødet**, ikke af rollen alene — en bruger kan
have flere roller.

### Signerede engangslinks er udskudt til 4.5

Fase 4.2 nævner "signerede engangslinks frem for åbne endpoints (byggespec §8)". De er **ikke**
bygget her. Vurdering kræver login.

Begrundelsen er ikke tid, men risiko: et engangslink er en **auth-fri skrivevej**, og den kan
først afprøves end-to-end når der findes en notifikationsmotor til at udsende den (4.5, blokeret
på Resend-konto). At bygge en auth-bypass der ikke kan gennemspilles er at optage
sikkerhedsgæld for en bekvemmelighed ingen kan bruge endnu. Byggespec §8's egentlige krav —
*ingen åbne endpoints* — er opfyldt af login-kravet. Registreret som **B-21**.

## Konsekvenser

- Positive: 4.1 og 4.2 er funktionelle uden en eneste leverandørkonto. De tre synlighedsvalg er
  testet med både positive og negative RLS-cases. Aggregeringen er en ren funktion med
  unit-tests. Ingen af de uafklarede punkter er besvaret ved et gæt.
- Negative / pris: forberedelsesnotens synlighed afviger fra `meeting_note`, hvilket er én
  ekstra ting at forklare indtil ejeren lukker *note-synlighed*. Rating-tabellens to nullable
  kolonner kræver check-constrainten for at være meningsfuld — fjernes den, bliver modellen
  tvetydig. Fase 4.2's DoD er ikke fuldt krydset af før B-21 er lukket.
- Opfølgning:
  - 🔴 TODO(ejer): note-synlighed — gælder nu `meeting_note`, `meeting_prep_note` og senere
    AI-resuméer (4.4). Ét svar lukker tre steder.
  - 🔴 TODO(ejer): hvad ratings bruges til. Indtil da læser matchingen ikke `meeting_rating`.
  - 🟡 B-21: signerede engangslinks sammen med notifikationsmotoren i 4.5.
  - 🟡 Db-testene for 0015 er **ikke kørt lokalt** — Docker mangler på maskinen (B-13), så CI
    er eneste gate for denne migrations RLS.
