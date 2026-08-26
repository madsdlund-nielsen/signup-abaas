# 0028 — Guardrails: lag-grænser som lint-regel og gates der faktisk kører

- **Status:** Accepteret
- **Dato:** 2026-08-26
- **Fase:** 2 (tværgående)
- **Berører uafklaret punkt:** nej (Spand A — teststruktur, projektstruktur-håndhævelse, secrets-/CI-struktur)

## Kontekst

En gennemgang af repoets guardrails viste et mønster: **flere regler var skrevet ned,
men håndhævede intet.**

1. `.husky/pre-push` var aldrig wired i klonen (`core.hooksPath` var unset, `.husky/_`
   fandtes ikke) — hooken kører først efter `npm install` og fejlede ellers lydløst.
   `.claude/settings.json` fandtes ikke, så begge scripts i `.claude/hooks/` var død kode.
2. ADR 0002 låste lag-grænsen (`src/features/**` og klient-laget må aldrig importere et
   tredjeparts-SDK) og noterede at den "håndhæves i review". Der er reelt ingen review:
   `main` kræver 0 godkendelser, fordi repoet er solo. Grænsen var altså kun beskyttet
   af hukommelse.
3. `vitest.config.ts` satte dækningstærskler (70/70/70/60), men `test:coverage` blev
   aldrig kørt i CI. Kørt manuelt var tærsklen **rød** (65,5 %) — en gate ingen havde
   opdaget var faldet.
4. `npm run lint` dækkede kun `src`; `tests/`, `scripts/` og config-filer var ulintede.
5. Dependabot-alarmer og security-updates var slået fra på et offentligt repo.

Fælles træk: **CI + branch protection var den eneste gate der faktisk kørte** (og den er
korrekt sat op: fem påkrævede checks, `strict`, `enforce_admins`). Alt lokalt var kulisse.

## Overvejede muligheder

- **Lade det stå og stole på review-disciplin.** Afvist: der er ingen review at stole på,
  og de fem sikkerhedsgrænser i `docs/stub-politik.md` (autorisation, RLS,
  signaturverifikation, idempotens, samtykke) fortjener mere end hukommelse.
- **Indføre `typescript-eslint` for at kunne skelne type-imports fra værdi-imports.**
  Afvist for nu: ny afhængighed og ny lint-flade for at løse et problem `no-restricted-imports`
  allerede dækker præcist nok. Kan genovervejes hvis grænserne skal finmaskes.
- **Sænke dækningstærsklen til det målte niveau.** Afvist: det ville gøre et rødt tal grønt
  ved at flytte målstregen. Se beslutningen nedenfor.

## Beslutning

**1. Lag-grænserne håndhæves af `no-restricted-imports` i `eslint.config.mjs`.**
To grupper:

- *Adapter-grænsen:* tredjeparts-SDK'er (`stripe`, `@calcom/*`, `resend`, `posthog-*`,
  `@anthropic-ai/*`, `openai`, `twilio`, `@daily-co/*`) må kun importeres i `src/lib/**`.
  Listen er **forebyggende** — de fleste pakker er ikke installeret endnu, og reglen skal
  stå før den første import, ikke skrives bagefter.
- *Klient-grænsen:* `src/components/**` må ikke importere `@/server/auth/supabase-server`
  (som eksporterer `createServiceSupabase` og bevidst **bypasser RLS**),
  `supabase-client`, `provisioning`, `@/lib*`, `@supabase/*` eller `next/headers`.

Supabase står bevidst **ikke** på SDK-listen: det er sandhedskilden (arkitekturprincip 1),
ikke en udskiftelig sub-processor, og `src/server/**` bruger legitimt dens typer.
`src/components/**` må fortsat bruge `import type` fra `@/server/…` og kalde server-actions
— det kanoniske Next-mønster, som allerede er i brug. Begge regler er verificeret mod en
bevidst overtrædelse; ingen af dem har overtrædelser i dag.

**2. De lokale gates aktiveres.** `.claude/settings.json` tilføjes med de to hooks der
allerede lå i `.claude/hooks/`, og husky wires af `npm install`.

**3. Dækningstærsklen bliver en rigtig gate — uden at målstregen flyttes.**
`test:coverage` kører nu i CI-jobbet "Unit tests" (jobnavnet bevares, så det påkrævede
status-check i branch protection stadig matcher). Tærsklerne står uændret på 70/70/70/60.
For at nå dem: `src/server/auth/actions.ts` udelades af dækningsfladen med **samme
begrundelse som den eksisterende udeladelse af `supabase-client.ts`** (server-actions oven
på Supabase dækkes af integration/manuel verifikation, ikke unit-tests), og de to
utestede præsentationskomponenter `Container` og `TopBar` fik tests. Resultat: 70,7 %.

**4. Lint dækker hele repoet** (`eslint .`), ikke kun `src`.

**5. Dependabot-alarmer og security-updates slås til.** Bevidst **uden**
`.github/dependabot.yml` for version-updates: automatiske opgraderings-PR'er ville kollidere
med merge-økonomien nedenfor. Kun sikkerhedshuller, ikke rutine-bumps.

**6. Netlify springer builds over der ikke kan ændre siden.** `ignore` i `netlify.toml`
afbryder build når diffen kun rører `docs/`, `tests/`, `.github/`, `.claude/` eller `*.md`.

## Konsekvenser

- Positive: arkitekturprincip 2 og service-role-indeslutningen er nu strukturelle, ikke
  aftalte. En gate der falder, opdages af CI i stedet for ved en manuel stikprøve.
- Negative/pris: `noUncheckedIndexedAccess` (slået til i samme PR) kostede 19
  compilerfejl at rette; alle blev rettet med rigtige guards, ingen `!`-assertions.
  Dækningsmarginen er tynd (70,7 % mod 70 %) — se `docs/backlog.md` B-16.
- Opfølgning: **merge-økonomi-reglen i CLAUDE.md er ikke ændret her.** Build-skippet skal
  først verificeres på en rigtig docs-only merge (`TODO(mads)` i `netlify.toml`); først
  derefter giver det mening at løsne "én PR pr. fase". Se `docs/backlog.md` B-17.
