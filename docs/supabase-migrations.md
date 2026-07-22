# Supabase-migrationer til produktion — runbook

> Se ADR 0015. **Migrationer deployes automatisk:** Supabase' GitHub-integration anvender
> `supabase/migrations/*.sql` (inkl. RLS-policies) ved merge til `main`. Ingen manuel `db push`
> under normal drift. Verificér i Supabase → SQL Editor:
> `select * from supabase_migrations.schema_migrations order by version;`

## Sådan tilføjer du en ændring

1. Skriv en ny fil i `supabase/migrations/` (fortsæt `NNNN_navn.sql`-serien). **RLS-policies hører
   med i migrationen** — ikke i en separat mappe (ADR 0007-opdatering; den mappe deployes ikke).
2. Tilføj db-tests (positiv + negativ RLS) — `npm run test:db`.
3. Merge PR → integrationen anvender migrationen på prod automatisk.

## Fejlfinding

- **Ser en authed-læsning 0 rækker, selv om data findes?** Tjek at tabellens policy findes i prod:
  `select tablename, policyname from pg_policies where schemaname='public';`. Mangler den, ligger
  policyen sandsynligvis i en fil integrationen ikke deployer — flyt den ind i en migration.
- **Er en migration ikke anvendt?** Tjek `supabase_migrations.schema_migrations`. Er integrationen
  nede, kan CLI'en bruges som fallback: `npm run db:link` + `npm run db:push` (kræver projekt-ref +
  DB-adgang).

## Aktuel baseline

`0001` roller · `0002` board · `0003` RLS-hærdning · `0004` auth-bruger-cascade ·
`0005` kompetence-tags + `has_role` · `0006` RLS-policies (flyttet ind i migrations).
