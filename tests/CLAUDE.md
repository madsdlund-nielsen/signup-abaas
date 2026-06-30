# tests/ — testkonventioner for ABaaS

> Læs `CLAUDE.md` (rod) først. Dette dokument styrer **hvordan** tests skrives og
> hvor de hører hjemme. `auto-tests`-skillen følger det.

## Runner og lag

Test-runner er **Vitest** (ADR 0003), opdelt i tre projekter i `vitest.workspace.ts`:

| Lag | Miljø | Path | Hvornår |
|---|---|---|---|
| Unit | jsdom | `tests/unit/` | Hver kodeændring (komponenter, flags, consent, rene funktioner) |
| Integration | node | `tests/integration/` | Adapter-/modul-wiring uden netværk (fx adapter-registry) |
| DB | node | `tests/db/` | Schema- og RLS-ændringer (mod lokal Postgres) |

Kør:
```bash
npm run test:unit            # jsdom
npm run test:integration     # node
npm run db:test:up           # docker Postgres + wait-for-db (kræves før test:db)
npm run test:db
npm run test:coverage        # scoped coverage (src/components, src/server/flags)
```

## Mappe-layout
```
tests/
├── CLAUDE.md            # denne fil
├── setup/
│   ├── unit.ts          # RTL cleanup
│   ├── db-global.ts     # globalSetup: nulstil + migrate + seed
│   ├── auth-shim.sql    # lokal auth.uid() (spejler Supabase)
│   └── seed.sql         # app_authenticated-rolle + seed-data
├── unit/                # *.test.ts(x)
├── integration/         # *.test.ts
├── db/                  # *.test.ts (+ helpers.ts: asUser)
└── scripts/             # wait-for-db.mjs m.fl.
```

## Kortlægning: kilde → test

| Kilde | Test-lag | Eksempel |
|---|---|---|
| `src/components/**` | unit (token-only) | `tests/unit/components.test.tsx` |
| `src/server/flags`, `src/server/consent` | unit | `tests/unit/flags.test.ts`, `consent.test.ts` |
| `src/lib/<vendor>/**` (adaptere) | integration (registry/wiring) | `tests/integration/adapters.test.ts` |
| `supabase/migrations/**`, `supabase/policies/**` | db (RLS) | `tests/db/rls.test.ts` |

## Konventioner

- **Path-alias:** importér fra `@/...` (→ `src/...`).
- **Komponenter:** test at styling kommer fra token-klasser — **ingen inline-styles**, ingen
  hardcodede farver/fonts/radius/spacing. Brug `@testing-library/react`.
- **Adaptere:** test at factoryen returnerer en **stub** når flag=OFF/nøgle mangler; at
  fire-and-forget-stubs (email/sms/analytics) resolver; at backend-stubs kaster
  `NotConfiguredError`. Importér porte via `@/lib` — aldrig et SDK direkte.
- **RLS (db):** kør som rollen `app_authenticated` via `asUser(sub, ...)` i `tests/db/helpers.ts`.
  **Negative policy-tests er obligatoriske** (fx at en partner uden for et board, eller en
  fremmed ejer, ser 0 rækker) — ikke valgfrie. Nye RLS-tabeller kræver både positive og
  negative cases.
- **Dansk** i `describe/it`-beskrivelser hvor koden er dansk-tung.
- **Genbrug mønstre:** læs en eksisterende test i samme lag før du skriver en ny; indfør ikke
  nye runnere, mock-biblioteker eller mønstre uden en ADR.
- Slet aldrig eksisterende tests for at få en suite grøn.
