# 0006 — Migrationsflow og database-navnekonventioner

- **Status:** Accepteret
- **Dato:** 2026-06-30
- **Fase:** 0
- **Berører uafklaret punkt:** nej (Spand A — migrationsværktøj/-flow + DB-navnekonventioner)

## Kontekst

Supabase er sandhedskilde. Vi skal vælge migrationsværktøj/-flow og
navnekonventioner — og kunne teste schema/RLS lokalt UDEN et Supabase-projekt
(adgang gives næste uge). qlim8 bruger Drizzle; det er ikke givet for Supabase.

## Overvejede muligheder

- **Drizzle** (som qlim8) — god DX, men lægger et ORM oven på Supabase og ejer ikke
  RLS-policies naturligt.
- **Supabase-native SQL-migrationer** — rå SQL i `supabase/migrations/`, policies i
  `supabase/policies/`, reviewbare i PR, kører på enhver Postgres.

## Beslutning

Supabase-native SQL-migrationer. `supabase/migrations/*.sql` følger generate → review
→ staging → prod (aldrig push-mod-prod); `supabase/policies/*.sql` holder RLS pr.
rolle, versioneret. I CI og lokalt anvendes filerne mod en Postgres 16-container
(intet Supabase-projekt nødvendigt). **Navnekonventioner:** snake_case; **ental**
tabelnavne (`app_user`, `board`); FK navngivet `<tabel>_id` (`owner_id`, `board_id`);
enum `user_role`; sekventielt nummererede migrationsfiler (`0001_…`, `0002_…`).

## Konsekvenser

- Positive: RLS lever i SQL tæt på skemaet; kører kontofrit i CI; ingen ORM-binding.
- Negative/pris: mindre type-sikker query-DX end et ORM (kan tilføjes senere oven på SQL).
- Opfølgning: rigtigt Supabase-projekt (EU) + staging/prod-review-flow oprettes når
  adgang gives (Trin 2).
