# 0013 — Auth: Supabase Auth

- **Status:** Accepteret
- **Dato:** 2026-07-21
- **Fase:** 0
- **Berører uafklaret punkt:** punkt 25 (Supabase Auth vs. eget system) — nu afklaret af Mads.

## Kontekst

Auth-leverandøren var en åben 🟡 SPIKE (`docs/spikes/auth.md`). Krav: samspil med RLS
(`auth.uid()`), EU-residens, og fremtidigt Stripe/MobilePay-flow (kunde↔bruger-kobling).
`src/server/auth` var allerede en provider-agnostisk port (`SessionProvider` + `AuthUser`), og
RLS-policies (`supabase/policies/board.sql`) er skrevet mod `auth.uid()` — præcis Supabase' model.

## Overvejede muligheder

- **Supabase Auth** — leverer `auth.uid()`/JWT-claims som vores RLS allerede bruger; samme
  leverandør som databasen (én EU-region, eu-north-1); mindst vedligehold.
- **Eget auth-system** — fuld kontrol, men vi skal selv bygge session, JWT, sikkerhed og
  RLS-integration — betydelig kompleksitet og angrebsflade uden gevinst her.

## Beslutning

**Supabase Auth**, region **eu-north-1 (Stockholm)** — sammen med databasen.

Implementering bag den uændrede port (`src/server/auth`):
- `SupabaseSessionProvider` (`supabase-provider.ts`) mapper session → `AuthUser`.
- Session læses med `@supabase/ssr` `createServerClient` + request-cookies; `auth.getUser()`
  **JWT-verificerer** brugeren (parser ikke bare cookien). SDK-glue isoleret i `supabase-client.ts`
  og loades kun dynamisk når auth er konfigureret, så stub-stien (kontofri CI) er SDK-fri.
- Roller læses fra `user_role_assignment` med **service-role-klienten** (server-only).
- `createSessionProvider(env)` vælger Supabase når URL + anon + service-role er sat, ellers stub
  (samme mønster som adapterne i `src/lib`).

**RLS-hærdning (samme ændring):** `app_user` og `user_role_assignment` fik RLS aktiveret
(`0003_auth_rls.sql`) med **select-egne-rækker** og **ingen** insert/update/delete-policies
(`supabase/policies/roles.sql`). Uden dette ville Supabase' default-grants lade en autentificeret
bruger selv-tildele `admin`. Rolletildeling sker kun via service-role. Mønster jf. ADR 0007;
positive + negative tests i `tests/db/roles-rls.test.ts`.

## Konsekvenser

- Positive: `auth.uid()` virker uden ekstra lag; ét EU-datadomæne (eu-north-1); rolle-selvtildeling
  lukket; login/session testbart uden netværk (injicerbar gateway).
- Negative / pris: binder auth til Supabase (afbødet af den leverandør-neutrale port). Roller læses
  via service-role, så nøglen skal beskyttes strengt (server-only, aldrig `NEXT_PUBLIC_`).
- Opfølgning:
  - Login/signup-**UI** (styled forms per design-tokens) hører til fase 1-onboarding — ikke her.
  - Supabase-DPA underskrives før produktion (ejer/jura).
  - Cookie-refresh i middleware/route handlers tilføjes når der findes beskyttede ruter (fase 1).
