# 0015 — Migrationer til produktion (Supabase CLI)

- **Status:** Accepteret
- **Dato:** 2026-07-22
- **Fase:** 1
- **Berører uafklaret punkt:** nej (udbygger ADR 0006 migrationsflow med prod-anvendelse).

## Kontekst

ADR 0006 fastlagde migrationsformatet (`NNNN_navn.sql` i `supabase/migrations/`, snake_case) og
at db-testene anvender dem mod lokal Postgres. Men der var **ingen defineret vej til at anvende
dem på det rigtige Supabase-projekt** — schemaet blev første gang påført prod manuelt via SQL-
editoren. Det gav tavse fejl (fx manglende tabeller/rolle) og var kilden til en lang fejljagt i
fase 1.1. Vi mangler en gentagelig, sporbar prod-migration.

## Overvejede muligheder

- **Supabase CLI `db push`** — læser `supabase/migrations/*.sql`, anvender dem der ikke er kørt,
  og sporer tilstanden i `supabase_migrations.schema_migrations`. Samme filer som db-testene.
- **Egen migration-runner** (psql + egen sporingstabel) — mere kode at vedligeholde; genopfinder
  det CLI'en allerede gør.
- **Fortsæt manuelt via SQL-editor** — ikke sporbart, fejlbart (som vi så).

## Beslutning

**Supabase CLI `db push`**, kørt **manuelt** (ikke auto-CI endnu — prod-schemaændringer skal ses
af et menneske før de rammer data). Flow:

1. Én gang: `supabase init` + `supabase link --project-ref <ref>` (Mads — kræver projekt-ref +
   DB-adgang).
2. **Reconciliation** (én gang): 0001–0003 blev påført prod manuelt, så CLI'en tror de mangler.
   Markér dem som kørte uden at gen-anvende: `supabase migration repair --status applied 0001 0002 0003`.
   0004+ (auth-cascade og frem) pushes normalt.
3. Fremover: nye migrationer tilføjes i `supabase/migrations/`, `supabase db push` anvender dem.

Se runbook: `docs/supabase-migrations.md`. Bekvem-scripts: `npm run db:link|db:push|db:diff`.

## Konsekvenser

- Positive: sporbar, gentagelig prod-migration; samme filer som testene; ingen håndkørte SQL.
- Negative / pris: kræver Supabase-CLI + projekt-adgang (Mads). Manuel kørsel = et menneske skal
  huske at pushe efter merge (bevidst — sikkerhed over bekvemmelighed indtil vi stoler på flowet).
- Opfølgning:
  - 🔴 TODO(mads): kør `init` + `link` + `migration repair` på prod-projektet én gang.
  - 🟡 Filnavne: CLI'en genererer normalt tidsstemplede versioner. Vi beholder `NNNN_`-serien
    (ADR 0006) som baseline; hvis `db push` afviser prefikset, skiftes til tidsstempler fra næste
    migration (beslutning udskudt til første konflikt — flag til Mads).
  - 🟡 Senere: evt. auto-`db push` i CI på merge til main, når flowet er kørt manuelt et par gange.
