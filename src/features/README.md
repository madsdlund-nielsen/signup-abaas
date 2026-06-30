# src/features — feature-baseret domænekode

Hver mappe ejer sit eget domæne (komponenter, hooks, server-actions, typer).
Strukturen er feature-baseret, ikke lag-baseret — se `docs/adr/0002-*.md` og
`docs/projektstruktur.md`.

Tiltænkte features (rejses fra fase 1):

- `onboarding/` — quiz, conversational flow
- `board/` — matching, anbefaling, lead-partner
- `booking/` — Cal.com, møder, status, noter
- `betaling/` — prisberegner, checkout, varierende betalingsfrekvenser
- `honorar/` — opgørelse, udbetaling
- `rating/` — forberedelse, feedback

## Lag-grænse (håndhæves)

`src/features/**` må **aldrig** importere et tredjeparts-SDK direkte. Al kontakt
med Cal.com, Stripe/MobilePay, video, LLM, e-mail, SMS, bogføring osv. går gennem
en adapter-port i `src/lib/`. Det er det der gør leverandører udskiftelige
(arkitekturprincip 2 i `CLAUDE.md`). Se `docs/adr/0004-*.md`.
