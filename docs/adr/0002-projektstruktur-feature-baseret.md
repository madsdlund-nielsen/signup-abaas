# 0002 — Projektstruktur: feature-baseret + lib/server-grænse + komponenttilgang

- **Status:** Accepteret
- **Dato:** 2026-06-30
- **Fase:** 0
- **Berører uafklaret punkt:** nej (Spand A — mappe-/projektstruktur + komponentbibliotek-tilgang)

## Kontekst

Fase 0 rejser `src/`. Vi skal låse hvordan koden organiseres, hvor grænsen mellem
domæne og tredjeparts-SDK'er går, og hvordan UI-komponenter bygges oven på
design-tokens. `docs/projektstruktur.md` anbefaler feature-baseret; valget kræver
en ADR (Spand A i CLAUDE.md).

## Overvejede muligheder

- **Lag-baseret** (alle `services/`, `controllers/`, `components/` samlet) — velkendt,
  men spreder én feature ud over hele træet og modarbejder clean handover.
- **Feature-baseret** (`src/features/<domæne>/`) — hver feature ejer egne
  komponenter/hooks/actions/typer; al fx booking-kode ét sted.

For komponenter: egne lette komponenter oven på tokens vs. et headless-bibliotek.

## Beslutning

Feature-baseret struktur: `src/features/{onboarding,board,booking,betaling,honorar,rating}`.
`src/lib/` rummer adaptere til sub-processorer; `src/server/` rummer flags,
auth-abstraktion og delt domænelogik; `src/components/` er ren præsentation der KUN
refererer design-tokens. **Lag-grænse:** `src/features/**` må aldrig importere et
tredjeparts-SDK direkte — al ekstern kontakt går gennem en port i `src/lib/`.
Komponenter bygges som egne, lette komponenter oven på `docs/design-tokens.css`
(ingen tung component-library-afhængighed nu), så "border-radius: 0", tynde
overskrifter og guld-som-sparsom-accent holdes under fuld kontrol.

## Konsekvenser

- Positive: features bygges/testes isoleret; leverandører er udskiftelige; designet
  styres ét sted.
- Negative/pris: kræver disciplin for at undgå utilsigtede SDK-importer i features
  (håndhæves i review; kan senere håndhæves med en lint-regel).
- Opfølgning: et headless-bibliotek (fx for komplekse a11y-widgets) kan genovervejes
  i en senere ADR hvis behovet opstår.
