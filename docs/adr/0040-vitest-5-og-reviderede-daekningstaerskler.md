# 0040 — Vitest 5: AST-aware dækning og reviderede tærskler

- **Status:** Accepteret
- **Dato:** 2026-09-11
- **Fase:** 4 (tværgående)
- **Opdaterer:** ADR 0033 (Vitest 3) og ADR 0028 (dækningstærsklerne 70/70/70/60)
- **Berører uafklaret punkt:** nej (Spand A — test-runner og teststruktur)

> **Skrevet efter merge.** CLAUDE.md kræver ADR i samme PR som beslutningen. Denne kom
> efter: PR #43 (bumpet) og #45 (dækningsfixet) var merget da tærskeltallene blev valgt.
> Gælden er noteret her frem for skjult, og tærskelændringen selv ligger i denne PR.

## Kontekst

Dependabot åbnede PR #43 med et spring fra Vitest 3.2.7 til **5.0.0** — to majors, fordi
`@vitest/mocker`, `@vitest/coverage-v8` og `vitest` skal følges ad. Jobbet "Unit tests"
blev rødt, men **ikke på en testfejl**: alle 135 tests bestod. Jobbet stoppede på gaten:

```
ERROR: Coverage for functions (67.36%) does not meet global threshold (70%)
```

Årsagen er, at Vitest 4 gør **AST-aware remapping** til standard i v8-provideren; i
Vitest 3 var den opt-in bag `experimentalAstAwareRemapping`. Dermed skifter selve
tælleenheden, og tallene før og efter måler ikke det samme:

| Enhed | Vitest 3 | Vitest 5 |
|---|---|---|
| Statements | 1039 | 269 |
| Functions | 61 | 95 |
| Branches | 192 | 237 |

Vitest 3 talte reelt *linjer* som statements og så kun en brøkdel af funktionerne.
Fire filer uden tests rapporterede derfor **100 % funktionsdækning på trods af 0 %
statements** — et tal der aldrig kunne passe:

| Fil | Vitest 3 | Vitest 5 |
|---|---|---|
| `OptionsSection.tsx` | 1/1 | 0/10 |
| `supabase-server.ts` | 1/1 | 0/4 |
| `PageHeader.tsx` | 1/1 | 0/2 |
| `PartnerCard.tsx` | 1/1 | 0/2 |

De 18 funktioner forklarer hele faldet. Gaten fangede altså ikke en regression fra
opgraderingen, men dækning der hele tiden manglede.

`docs/backlog.md` B-20 forudsagde præcis dette, inklusive at det ville kræve "enten flere
tests (se B-16) eller en revideret tærskel — ikke bare et versionsbump". Den note holdt.

## Overvejede muligheder

- **Sænke tærsklen til det målte.** Afvist af samme grund som i ADR 0028: det gør et rødt
  tal grønt ved at flytte målstregen. B-16 foreskriver udtrykkeligt det modsatte.
- **Fravælge AST-aware remapping.** Ikke en reel mulighed i Vitest 5 — den er standard,
  ikke et flag. Og den er mere korrekt end det den erstatter; at vælge den fra ville være
  at foretrække et forkert tal.
- **Skrive tests og rydde dækningsfladen, derefter hæve tærsklen.** Valgt.

## Beslutning

**1. Opgraderingen tages** (`vitest` og `@vitest/coverage-v8` på `^5.0.0`). Suiten kørte
igennem uden én ændring i en eksisterende testfil, som ved Vitest 3.

**2. `src/server/auth/supabase-server.ts` udelades af dækningsfladen** med samme
begrundelse som de to eksisterende udeladelser (`supabase-client.ts`, `actions.ts`):
den konstruerer request-scopede Supabase-klienter og har ingen egen logik. Den stod
allerede på 0 % linjer under Vitest 3; først AST-remappingen fik dens funktioner til at
tælle med. Det er tredje fil i samme kategori, ikke en ny undtagelse.

**3. `PageHeader` og `PartnerCard` har fået unit-tests** (13 tests, token-only efter
`tests/CLAUDE.md`). `PartnerCard` var navngivet i B-16.

**4. Tærsklerne revideres** fra 70/70/70/60 til:

| Metrik | Før | Nu | Målt | Margin |
|---|---|---|---|---|
| Lines | 70 | **75** | 80,00 % | 5,00 |
| Statements | 70 | **75** | 77,86 % | 2,86 |
| Functions | 70 | **70** | 74,72 % | 4,72 |
| Branches | 60 | **70** | 77,63 % | 7,63 |

Branches havde 17,6 points slæk og var reelt ikke en gate; den strammes mest. Functions
bliver stående på 70, fordi `OptionsSection.tsx` endnu er utestet — at hæve den nu ville
gøre den sidste åbne B-16-post til en blokering frem for en opgave.

## Konsekvenser

- Positive: dækningstallene betyder nu noget. Et utestet modul kan ikke længere skjule sig
  bag en 100 %-funktionsdækning det ikke har. Branches er en rigtig gate for første gang.
- Negative/pris: marginen på statements er 2,86 points (ca. 7 statements ud af 262). Det
  er fire gange bedre end de 0,7 points ADR 0028 flagede som tyndt, men det er stadig det
  tal der først tipper rødt. Dækningsfladen er scoped til `src/components`,
  `src/server/flags` og `src/server/auth`, så nævneren vokser kun når de mapper gør.
- Bemærk: `@vitejs/plugin-react` og Vite opgraderes fortsat ikke. Vite er låst til
  `^6.4.3` via `overrides` (ADR 0036), hvilket Vitest 5 accepterer (`^6.4.0 || ^7 || ^8`).
- Opfølgning: `OptionsSection.tsx` står på 0 af 10 funktioner og er det største hul —
  se `docs/backlog.md` B-16. Vite 8, `@vitejs/plugin-react` 6 og oprydningen i `overrides`
  står stadig åbne i B-20.
