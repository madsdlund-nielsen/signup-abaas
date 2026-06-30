# Spike — Auth (Supabase Auth vs. eget system)

> 🟡 SPIKE (Trin 4, arbejdspakke 0.8). Rører ⚠ punkt 25. **Claude Code beslutter ikke auth** —
> vurdér, byg en minimal isoleret prøve som *bevis*, skriv anbefaling, og STOP. Mads vælger.
> RLS-fundamentet er allerede bygget uafhængigt (hænger på rolle-relationen, ikke leverandøren).

## Formål
Vælg auth-løsning der opfylder: samspil med RLS (`auth.uid()`), EU-residens, og senere
Stripe/MobilePay-flow.

## Hvad skal verificeres
1. RLS-samspil: leverandørens session leverer `auth.uid()`/JWT-claims som vores policies bruger.
2. EU-residens for auth-data.
3. Rolle-relation: login → tildel/hent roller (ejer/partner/lead_partner/admin) → RLS håndhæver.
4. Fremtidssikring: spiller sammen med betalings-flow (kunde↔bruger-kobling).

## Evalueringskriterier
| Kriterium | Supabase Auth | Eget system | Vægt |
|---|---|---|---|
| RLS-samspil (`auth.uid()`) | | | skal-krav |
| EU-residens | | | skal-krav |
| Rolle-relation | | | skal-krav |
| Vedligehold/kompleksitet | | | vigtig |
| Stripe/MobilePay-flow senere | | | vigtig |

## Kontofri forberedelse (gjort/kan gøres nu)
- `src/server/auth` er allerede en provider-agnostisk port (`SessionProvider` + `AuthUser`).
- RLS-policies bruger `auth.uid()` præcis som Supabase; en test-shim beviser dem lokalt.
- Den valgte leverandør implementeres bag `SessionProvider` **uden** at røre policies.

## Beslutnings-gate
**STOP** efter anbefalingen. Mads vælger. Derefter: auth-ADR + integrér den valgte leverandør
bag `src/server/auth` (registrér via `setSessionProvider`).
