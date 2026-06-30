---
name: auto-tests
description: Tilføj passende tests til den eksisterende Vitest-suite for nye eller ændrede features i signup-abaas. Brug ved nye React-komponenter, server-utilities (flags/consent/auth), sub-processor-adaptere, eller schema/RLS-ændringer — eller når brugeren beder om "tilføj tests", "skriv tests", "test denne feature". Følger konventionerne i tests/CLAUDE.md.
allowed-tools: Read, Edit, Write, Bash(git diff:*), Bash(git status:*), Bash(npm run test:unit:*), Bash(npm run test:integration:*), Bash(npm run test:db:*), Bash(npm run db:test:up:*), Grep, Glob
---

# auto-tests — tilføj tests efter ABaaS-konventioner

Læs `CLAUDE.md` (rod) og `tests/CLAUDE.md` først. Indfør aldrig nye runnere/mønstre.

## 1. Find hvad der er ændret
```bash
git diff --name-only
git status --short
```

## 2. Klassificér og vælg lag (jf. tests/CLAUDE.md)

| Ændret kilde | Test-lag | Hvad testes |
|---|---|---|
| `src/components/**` | unit | render via token-klasser, **ingen inline-styles** |
| `src/server/flags`, `src/server/consent`, rene funktioner | unit | adfærd + edge cases |
| `src/lib/<vendor>/**` (adapter) | integration | factory returnerer stub uden nøgle; fire-and-forget resolver; backend kaster `NotConfiguredError` |
| `supabase/migrations/**`, `supabase/policies/**` | db | RLS — positive **og obligatoriske negative** cases |

## 3. Læs et eksisterende eksempel før du skriver
- Komponent: `tests/unit/components.test.tsx`, `tests/unit/PrimaryButton.test.tsx`
- Server-util: `tests/unit/flags.test.ts`, `tests/unit/consent.test.ts`
- Adapter: `tests/integration/adapters.test.ts`
- RLS: `tests/db/rls.test.ts` (+ `tests/db/helpers.ts` `asUser`)

Kopiér mønstret derfra — samme imports, struktur og stil.

## 4. Dæk det rette
- **Happy path** + relevante **edge cases** + **fejl**.
- **Komponenter:** klassenavne fra tokens, ingen `style`-attribut, korrekt heading-niveau/versal.
- **Adaptere:** stub-navn = `"stub"` uden nøgle; backend-operationer kaster `NotConfiguredError`.
- **RLS:** mindst én positiv og **mindst én negativ** case pr. ny adgangsregel (en der IKKE må se data ser 0 rækker).

## 5. Kør og verificér
```bash
npm run test:unit
npm run test:integration
npm run db:test:up && npm run test:db   # db kræver Docker
```

## 6. Rapportér
Hvilke tests blev tilføjet, hvilket lag, og at suiten er grøn.

## Vigtige regler
- Ingen nye test-runnere, mock-biblioteker eller mønstre uden en ADR.
- Mock ikke interne moduler medmindre det allerede er konventionen.
- RLS-negative-tests er **obligatoriske**, ikke valgfrie.
- Slet aldrig eksisterende tests. Importér fra `@/...`.
