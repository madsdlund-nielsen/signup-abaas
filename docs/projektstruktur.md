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
│   ├── features/                # feature-baseret domænekode
│   ├── components/              # delte UI-komponenter (bruger tokens)
│   ├── styles/                  # design-tokens.css loades her
│   ├── lib/                     # adaptere: cal.com, stripe, llm, video
│   └── server/                  # flags, auth, domænelogik
├── supabase/
│   ├── migrations/              # generate → review → staging → prod
│   └── policies/                # RLS-policies pr. rolle (versioneret)
├── tests/                       # unit / integration / db / e2e
├── .github/
│   └── workflows/ci.yml         # lint · type · test · branch protection
├── package.json
├── tsconfig.json
└── .env.example
```

## Princip: feature-baseret, ikke lag-baseret

`src/features/` grupperer kode efter **domæne**, ikke efter teknisk lag. Hver
feature ejer sine egne komponenter, hooks, server-actions og typer.

```
src/features/
├── onboarding/      # quiz, conversational flow
├── board/           # matching, anbefaling, lead-partner
├── booking/         # cal.com, møder, status, noter
├── betaling/        # prisberegner, checkout, frekvenser
├── honorar/         # opgørelse, udbetaling
└── rating/          # forberedelse, feedback
```

Hvorfor: features bygges og testes isoleret, og en fremtidig vedligeholdelses-
udvikler kan finde alt om fx booking ét sted. Lag-baseret (alle `services/`
samlet, alle `controllers/` samlet) spreder én feature ud over hele træet og
gør clean handover sværere — et af kerne­målene for greenfield-rewriten.

## Lag-grænser (vigtigt)

- `src/features/**` må IKKE importere tredjeparts-SDK'er direkte. Al kontakt med
  Cal.com, Stripe, video og LLM går gennem en adapter i `src/lib/`. Det er det
  der gør leverandører udskiftelige (jf. arkitekturprincip 2 i `CLAUDE.md`).
- `src/server/` ejer flags, auth-hjælpere og domænelogik der deles på tværs af
  features.
- `src/components/` er rent præsentation og refererer KUN design-tokens — aldrig
  hardcodede farver/fonts/radius.

## Design-tokens: én sandhedskilde

`docs/design-tokens.css` er kanonisk kilde. I trin 1b kopieres/importeres den
til `src/styles/`, som appen loader. Redigér altid kilden i `docs/` og hold
`src/styles/` i sync — afvig ikke værdierne i kode.

## Supabase

- `migrations/` — én migration pr. ændring, navngivet med tidsstempel. Følg
  generate → review SQL → staging → prod. Aldrig push-mod-prod.
- `policies/` — RLS-policies som versionerede filer, så autorisations­reglerne
  er reviewbare i PR og dækket af DB-tests.

## ADR-kandidater i denne struktur (skriv ADR ved valg)

- Feature- vs. lag-baseret opdeling (denne fil anbefaler feature-baseret).
- Navngivning og grænse mellem `lib/` (adaptere) og `server/` (domæne).
- Komponentbibliotek-tilgang: egne komponenter vs. headless oven på tokens.
- Test-mappens opdeling (unit/integration/db/e2e) og runner-valg.
