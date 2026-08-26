# 0035 — Projektstruktur: domænemapper under `src/server/`, ikke `src/features/`

- **Status:** Accepteret
- **Dato:** 2026-08-26
- **Fase:** 3 (tværgående)
- **Erstatter:** ADR 0002's mappe-opdeling (lag-grænsen og komponenttilgangen i 0002 består)
- **Berører uafklaret punkt:** nej (Spand A — mappe-/projektstruktur)

## Kontekst

ADR 0002 låste en feature-baseret struktur: `src/features/{onboarding,board,booking,betaling,honorar,rating}`,
hvor hver feature skulle eje sine egne komponenter, hooks, server-actions og typer.

Gennem fase 1–3 blev den struktur aldrig taget i brug. `src/features/` har hele vejen
indeholdt **kun en README**. Koden fandt i stedet et andet mønster — konsekvent, på tværs
af ti domæner:

```
src/server/<domæne>/    auth · flags · consent · gate · quiz · tags · partners
                        boards · matching · meetings · memberships · pricing · charges
   index.ts             business-data-access (authed klient, RLS scoper)
   actions.ts           mutationer ("use server", service-role bag rolle- + ejerskabstjek)
   <emne>.ts            ren logik (algorithm.ts, webhook.ts, portal.ts …)
src/app/                ruter (App Router)
src/components/         præsentation, kun design-tokens
src/lib/<leverandør>/   adapter-porte
```

Det er ikke rod — det er en anden, gennemført opdeling: **domæne under `server/`, rute
under `app/`, præsentation under `components/`.** Skellet mellem læsning (RLS-scopet) og
mutation (service-role bag eksplicitte tjek) er den bærende konvention, og den er
identisk i alle ti domæner.

Situationen var altså at det autoritative dokument beskrev én struktur, og koden en anden.
Registreret som `docs/backlog.md` B-05.

## Overvejede muligheder

- **Migrér koden til `src/features/`.** ~3.000 linjer flyttes for at matche et dokument.
  Ingen funktionel gevinst, betydelig konfliktflade midt i et forløb med åbne PR'er, og
  det ville sprede det etablerede `index.ts`/`actions.ts`-skel ud over tolv nye mapper.
- **Lade begge stå.** Afvist — en tom `features/`-mappe med en README der beskriver en
  ikke-eksisterende struktur (og nævner Stripe) er præcis den slags drift dette repo
  ellers er stramt om.
- **Dokumentér den faktiske struktur og fjern skallen.** Valgt.

## Beslutning

**Domænekode bor i `src/server/<domæne>/`.** `src/features/` og dens README slettes.

Det, ADR 0002 fik rigtigt, består uændret og er nu **håndhævet af lint** frem for hensigt
(ADR 0028):

- Tredjeparts-SDK'er må kun importeres i `src/lib/**` — al leverandørkontakt går gennem en
  port (arkitekturprincip 2).
- `src/components/**` er ren præsentation, refererer kun design-tokens, og må ikke
  importere server-only moduler.

Konventionen i hvert domæne:

| Fil | Ansvar |
|---|---|
| `index.ts` | Læsning via den authed klient — **RLS afgør synlighed**, ingen rolle-forgrening |
| `actions.ts` | Mutationer via service-role bag rolle- **og** eksplicit ejerskabstjek |
| øvrige | Ren, DB-fri logik der kan unit-testes (`algorithm.ts`, `webhook.ts` …) |

## Konsekvenser

- Positive: dokumentationen beskriver den kode der faktisk findes. Nye domæner har et
  entydigt mønster at kopiere, og lag-grænserne er uændrede — de er blot håndhævet nu.
- Negative/pris: ingen kodeflytning, så ingen risiko. `docs/projektstruktur.md` er rettet.
- Bemærk: dette ændrer **ikke** ADR 0002's lag-grænse eller komponenttilgang — kun hvor
  domænekoden bor. 0002 er annoteret, ikke slettet.
