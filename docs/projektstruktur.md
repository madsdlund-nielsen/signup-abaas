# Projektstruktur — signup-abaas

> Reference for den tiltænkte mappestruktur. Claude Code rejser `src/`,
> `supabase/`, `tests/` og `.github/` i fase 0. Strukturvalg her hører til
> **Spand A** i `CLAUDE.md` (kræver ADR) — afvig kun med en ADR der begrunder
> hvorfor. Læs `CLAUDE.md` og `docs/fase-0-eksekvering.md` først.

## Fuldt træ

```
signup-abaas/
├── CLAUDE.md                    # autoritativ styring — læses først
├── docs/                        # dokumentation (eksisterer)
│   ├── byggespec/               # menneske-spec (reference, versioneret)
│   │   ├── README.md            # seneste version + versioneringsprocedure
│   │   └── ABaaS_Byggespec_v5.pdf
│   ├── fase-0.md                # arbejdspakker + DoD
│   ├── fase-0-eksekvering.md    # trinsekvens + beslutnings-gates
│   ├── fase-1.md                # arbejdspakker + DoD
│   ├── designnoter.md           # designintention + do/don't
│   ├── design-tokens.css        # KILDE — kopieres til src/styles/
│   ├── projektstruktur.md       # denne fil
│   └── adr/
│       ├── README.md            # ADR-praksis + indeks
│       └── 0000-template.md     # skabelon
├── src/                         # applikationskode (rejses i fase 0)
│   ├── app/                     # Next.js App Router — sider/ruter
│   ├── components/              # delte UI-komponenter (bruger tokens)
│   ├── styles/                  # design-tokens.css loades her
│   ├── lib/                     # adaptere: cal.com, stripe, llm, video
│   └── server/                  # domænemapper: auth, quiz, boards, meetings … (ADR 0035)
├── supabase/
│   └── migrations/              # generate → review → staging → prod
│                                # (RLS-policies ligger I migrationerne — ADR 0007)
├── tests/                       # unit / integration / db / e2e
├── .github/
│   └── workflows/ci.yml         # lint · type · test · branch protection
├── package.json
├── tsconfig.json
└── .env.example
```

## Princip: domæne under `server/` (ADR 0035)

Domænekode grupperes efter **domæne**, ikke efter teknisk lag — men den bor i
`src/server/<domæne>/`, ikke i `src/features/`. ADR 0002 foreskrev oprindeligt
`src/features/`; den mappe blev aldrig taget i brug og er fjernet (ADR 0035).

```
src/server/
├── auth/            # session, roller, provisionering
├── quiz/            # spørgsmål, options, ejer-svar
├── tags/            # kompetence-tags (admin-styret)
├── partners/        # katalog, invitation, portal, self-service
├── boards/          # board-sammensætning, lead-partner
├── matching/        # board-matching-algoritmen
├── meetings/        # booking, status, noter
├── memberships/     # medlemskab + betalingsfrekvens
├── pricing/         # versionerede prisregler
└── charges/         # opkrævningsgrundlag
```

Konventionen i hvert domæne:

| Fil | Ansvar |
|---|---|
| `index.ts` | Læsning via den authed klient — **RLS afgør synlighed** |
| `actions.ts` | Mutationer via service-role bag rolle- **og** eksplicit ejerskabstjek |
| øvrige | Ren, DB-fri logik der kan unit-testes (`algorithm.ts`, `webhook.ts` …) |

## Lag-grænser (håndhævet af lint, ADR 0028)

- **Tredjeparts-SDK'er må kun importeres i `src/lib/`.** Al kontakt med Cal.com,
  Alunta, video og LLM går gennem en adapter-port — det gør leverandører udskiftelige
  (arkitekturprincip 2 i `CLAUDE.md`).
- **`src/components/` må ikke importere server-only moduler** — hverken
  `supabase-server` (som bypasser RLS), `@/lib` eller `next/headers`. `import type`
  og server-actions er fortsat i orden.
- Begge regler er `no-restricted-imports` i `eslint.config.mjs` — ikke hensigt.
- `src/components/` refererer KUN design-tokens, aldrig hardcodede farver/fonts/radius.

## Design-tokens: én sandhedskilde

`docs/design-tokens.css` er kanonisk kilde. I trin 1b kopieres/importeres den
til `src/styles/`, som appen loader. Redigér altid kilden i `docs/` og hold
`src/styles/` i sync — afvig ikke værdierne i kode.

## Supabase

- `migrations/` — én migration pr. ændring, navngivet med tidsstempel. Følg
  generate → review SQL → staging → prod. Aldrig push-mod-prod.
- **Ingen `policies/`-mappe.** ADR 0007 lagde RLS-policies i selve migrationerne, fordi
  Supabases deploy ellers ikke ville anvende dem. De er stadig reviewbare i PR og dækket
  af DB-tests — bare i samme fil som tabellen de beskytter.

## ADR-kandidater i denne struktur (skriv ADR ved valg)

- Navngivning og grænse mellem `lib/` (adaptere) og `server/` (domæne).
- Komponentbibliotek-tilgang: egne komponenter vs. headless oven på tokens.
- Test-mappens opdeling (unit/integration/db/e2e) og runner-valg.
