# Supabase-migrationer til produktion — runbook

> Se ADR 0015 for beslutningen. Migrationer ligger i `supabase/migrations/*.sql` og policies i
> `supabase/policies/*.sql` (samme filer som db-testene kører). Denne runbook er hvordan de rammer
> det rigtige Supabase-projekt sporbart — ikke via håndkørt SQL.

## Forudsætninger (Mads, én gang)

CLI: `npx --yes supabase --version` (eller installér globalt: <https://supabase.com/docs/guides/cli>).

```bash
npm run db:link        # = supabase link --project-ref <ref>   (kræver projekt-ref + DB-password)
```

`supabase init` køres første gang hvis `supabase/config.toml` ikke findes endnu.

## Reconciliation (én gang — fordi 0001–0003 blev påført prod manuelt)

CLI'en tror 0001–0003 mangler (de blev kørt via SQL-editoren, ikke via CLI). Markér dem som
allerede kørte, så de IKKE gen-anvendes:

```bash
npx --yes supabase migration repair --status applied 0001 0002 0003
```

> Bemærk: policies i `supabase/policies/` er ikke en del af CLI'ens migrationssporing. Ved første
> reconciliation anvendes `supabase/policies/*.sql` manuelt én gang (de blev også påført i hånden).
> Fremover holdes RLS-ændringer i migrationsfiler (så `db push` dækker dem), jf. ADR 0015-opfølgning.

## Løbende brug

```bash
npm run db:diff        # se hvad der er anderledes mellem lokal og prod
npm run db:push        # anvend ikke-kørte migrationer på prod
```

- Skriv nye ændringer som en ny fil i `supabase/migrations/` (fortsæt `NNNN_navn.sql`-serien).
- Efter merge til main: kør `npm run db:push` mod prod (manuelt, bevidst — jf. ADR 0015).

## Aktuel baseline

`0001` roller · `0002` board · `0003` RLS-hærdning · `0004` auth-bruger-cascade.
