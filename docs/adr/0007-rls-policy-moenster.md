# 0007 — RLS-policy-mønster og kontofri test

- **Status:** Accepteret
- **Dato:** 2026-06-30
- **Fase:** 0
- **Berører uafklaret punkt:** nej (Spand A — RLS-policy-mønster). Auth-LEVERANDØR er en åben spike (Trin 4), men RLS hænger på rolle-relationen, ikke på leverandøren.

## Kontekst

RLS er det primære autorisationslag (princip 5). Vi skal etablere et policy-mønster
med obligatoriske negative tests — og kunne teste det lokalt uden Supabase Auth
(auth-leverandøren er ikke valgt endnu).

## Overvejede muligheder

- **Egne GUC'er** (fx `app.current_user`) — afviger fra Supabase og kræver omskrivning
  senere.
- **Spejl Supabase:** policies bruger `auth.uid()`; lokalt leveres en lille shim.

## Beslutning

Policies bruger `auth.uid()` præcis som på Supabase. Mønster: én policy pr. adgangsvej,
navngivet `<tabel>_<operation>_<rolle>` (fx `board_select_owner`). I test leverer
`tests/setup/auth-shim.sql` et `auth.uid()` der læser
`current_setting('request.jwt.claim.sub')`, og tests kører som en ikke-ejende rolle
(`app_authenticated`) i en transaktion der rulles tilbage. De SAMME policies kører
uændret på Supabase (hvor `auth.uid()` er indbygget). Negative tests er obligatoriske
(partner uden for board / fremmed ejer ser intet) — se `tests/db/rls.test.ts`.

## Konsekvenser

- Positive: policies er produktionsidentiske; negative tests fanger fejl-åbninger;
  kontofri CI.
- Negative/pris: shim'en skal holdes i sync med Supabase' faktiske `auth.uid()`-semantik
  (minimal). Hjælpetabeller uden RLS (rolle/medlemskab) er læsbare for app-rollen —
  strammes når flere forretningstabeller kommer til.
- Opfølgning: når auth-spiken (Trin 4) er afgjort, integreres den valgte leverandør bag
  `src/server/auth` uden at røre policies.

## Opdatering (2026-07-22) — policies bor i migrations, ikke en separat mappe

Policies lå oprindeligt i `supabase/policies/*.sql`, anvendt separat af db-testenes globalSetup.
Men **Supabase' deploy (og GitHub-integrationen) anvender kun `supabase/migrations/`** — aldrig
den mappe. I prod var RLS derfor slået til uden policies → authed-læsning gav 0 rækker (verificeret
via `pg_policies`). Rettelse: alle policies flyttet ind i migrations (catch-up i `0006_rls_policies.sql`),
og `supabase/policies/`-mappen er fjernet. **Fremover:** en tabels RLS-policies skrives i SAMME
migration som tabellen (eller en efterfølgende migration) — så de deployes automatisk. Navngivning
(`<tabel>_<operation>_<rolle>`) og negative-test-kravet er uændret.
