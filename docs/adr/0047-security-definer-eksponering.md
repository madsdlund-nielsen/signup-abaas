# 0047 — SECURITY DEFINER-funktioner: hvad Supabase' linter må rette, og hvad den ikke må

- **Status:** Accepteret
- **Dato:** 2026-09-15
- **Fase:** — (sikkerhedshygiejne, tværgående)
- **Berører uafklaret punkt:** nej (Spand A — RLS-policy-mønster, udvider ADR 0007)

## Kontekst

Supabase' database-linter rapporterer otte advarsler mod vores projekt: fire
`SECURITY DEFINER`-funktioner i `public` er eksekverbare for `anon` og/eller
`authenticated` og dermed eksponeret som `/rest/v1/rpc/<navn>`. Linteren foreslår
tre generiske rettelser: **revoke EXECUTE**, **skift til SECURITY INVOKER**, eller
**flyt funktionen ud af det eksponerede skema**.

Advarslen rammer alle SECURITY DEFINER-funktioner ens, men vores fire er ikke ens.
Tre er vores egne (0004, 0005, 0011); den fjerde, `public.rls_auto_enable()`,
findes ikke i `supabase/migrations/` og heller ikke i git-historikken.

Rettelsen har en pris hvis den anvendes blindt: RLS er vores primære autorisationslag
(arkitekturprincip 5), og `has_role`/`is_partner_on_board` **kaldes af policies**.
ADR 0007 beskriver allerede en produktionshændelse hvor RLS var slået til uden policies
og authed læsning gav 0 rækker. Samme klasse af fejl er i spil her.

## Overvejede muligheder

Målt mod en lokal PostgreSQL 16 med Supabase-lignende roller og
`alter default privileges ... grant all on functions to anon, authenticated`:

- **A — revoke EXECUTE på alle fire.** Postgres tjekker EXECUTE mod *kalderens* rolle
  når en policy-expression kalder en funktion. Målt: efter revoke fejler en almindelig
  authed læsning med `ERROR: permission denied for function has_role` — ikke "0 rækker",
  men hård fejl. Autorisationslaget lukker.
- **B — skift til SECURITY INVOKER.** Målt: `is_partner_on_board` læser `board_partner`,
  hvis egen policy kalder `is_partner_on_board` → uendelig rekursion,
  `ERROR: stack depth limit exceeded`. Det er præcis grunden til at byggespec §6
  foreskriver SECURITY DEFINER-hjælpefunktioner.
- **C — flyt hjælperne til et ikke-eksponeret skema.** Teknisk muligt og den reelt rene
  løsning: `alter function ... set schema` bevarer funktionens OID, så eksisterende
  policies overlever. Men ~30 policies på tværs af otte migrationer refererer dem
  ukvalificeret, og enhver fremtidig policy skal huske præfikset. For stor en
  ændring at hænge på en linter-advarsel uden en dedikeret skive.
- **D — vurder funktionerne enkeltvis.** Skelner mellem eksponering der *kan* misbruges
  og eksponering der er ren støj.

## Beslutning

**D.** Vi retter én funktion, lader to stå med dokumenteret begrundelse, og behandler
den fjerde som drift der skal undersøges.

| Funktion | Beslutning | Hvorfor |
|---|---|---|
| `handle_auth_user_deleted()` (0004) | **EXECUTE fjernet** (migration 0016) | Trigger-funktion. Postgres afviser direkte kald ("trigger functions can only be called as triggers"), og triggeren fyrer uafhængigt af kalderens EXECUTE — begge dele målt. Rettighed uden formål → væk. |
| `has_role(user_role)` (0005) | **Urørt** | Kaldes af ~25 policies. Svarer kun på "har *jeg* denne rolle" via `auth.uid()`; `anon` får altid `false`. Ingen oplysning at lække — og A/B lukker autorisationen. |
| `is_partner_on_board(uuid)` (0011) | **Urørt** | Samme: svarer kun om kalderen selv sidder på boardet. Board-id'er er UUID'er, og svaret for et fremmed board er det samme som for et ikke-eksisterende. |
| `rls_auto_enable()` | **Undersøges** (backlog B-22) | Findes ikke i migrationer eller git. Ukendt SECURITY DEFINER-kode i produktionsdatabasen er et større spørgsmål end den advarsel der afslørede den. |

Den afgørende skelnen: begge hjælpere tager kalderens egen identitet fra `auth.uid()`
og kan ikke spørges om andre. Eksponeringen er derfor reel, men indholdsløs.
`search_path` er låst til `public` på alle tre (linteren flagger ikke
`function_search_path_mutable` — den farlige SECURITY DEFINER-fejl har vi ikke).

`leaked_password_protection` (samme rapport) er en dashboard-indstilling, ikke kode.
Vi bruger e-mail + selvvalgt adgangskode (`signInWithPassword`/`signUp`), så tjekket er
relevant. Koden er forberedt: `translateAuthError` oversætter HIBP-afvisningen til dansk,
så flaget kan vendes uden at sende en engelsk fejl i ansigtet på brugeren. Selve
vendingen er Mads' (backlog B-25).

## Konsekvenser

- Positive: to eksponerede RPC-endpoints færre; grunden til at de resterende to bliver
  stående er skrevet ned, så næste session (eller næste linter-kørsel) ikke "retter" dem
  og lukker autorisationslaget. `tests/db/security-definer-grants.test.ts` låser begge
  retninger fast — den negative *og* den positive.
- Negative / pris: linteren vil blive ved med at rapportere fire advarsler på
  `has_role` og `is_partner_on_board`. De er accepterede, ikke oversete; denne ADR er
  svaret næste gang rapporten dukker op.
- Opfølgning: **B-22** (hvad er `rls_auto_enable`, og hvordan endte den uden for
  migrationerne), **B-25** (slå leaked password protection til), **B-26** (mulighed C,
  hvis vi vil have rapporten helt ren).
