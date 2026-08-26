# 0029 — Webhook-idempotens skal betyde "præcis én gang", ikke "højst én gang"

- **Status:** Accepteret
- **Dato:** 2026-08-26
- **Fase:** 2
- **Præciserer:** ADR 0027 (webhook-ingest: signatur før alt, idempotens via event-tabel)
- **Berører uafklaret punkt:** nej

## Kontekst

ADR 0027 fastlagde mønstret: idempotensrækken i `meeting_webhook_event` skrives **før**
mutationen anvendes, og unique-constrainten `(provider, provider_event_id)` er selve
idempotensmekanismen. Det er rigtigt — men implementeringen havde et hul, fundet ved
kodegennemgangen der lukkede fase 2 (`docs/fase-2-rapport.md` §4).

Rækkefølgen var:

1. `insert` i `meeting_webhook_event` → lykkes
2. `update` på `meeting` → **fejler** (fx transient DB-fejl)
3. handleren svarer `500`

Cal.com genleverer ved manglende 2xx. Men genleveringen har samme deterministiske
event-id, rammer derfor unique-constrainten (`23505`), og handleren svarer `200 —
allerede behandlet`. **Eventet er dermed tabt for altid, uden nogensinde at være anvendt.**
En aflysning foretaget i Cal.com ville stille blive væk, og `meeting` — sandhedskilden —
ville divergere fra provideren uden at nogen opdagede det.

Hullet er ikke teoretisk: `500` returneres netop i den situation hvor en genlevering er
hele pointen.

## Overvejede muligheder

- **Skriv idempotensrækken EFTER mutationen.** Afvist: så er vinduet omvendt — to
  samtidige leverancer af samme event kan begge nå at mutere før nogen af dem har skrevet
  rækken. Det bytter et tabt event ud med en dobbelt mutation, hvilket er værre.
- **To-fase-række med `applied_at`:** skriv rækken først, sæt `applied_at` efter en
  vellykket mutation, og lad en genlevering af en ikke-anvendt række køre igennem.
  Korrekt, men kræver en migration og gør genlevering afhængig af oprydningslogik.
- **Rul rækken tilbage når mutationen fejler.** Valgt — se nedenfor.

## Beslutning

**Fejler mutationen, slettes idempotensrækken igen, før der svares `500`.**

Rækken markerer dermed "dette event ER anvendt", ikke blot "dette event er set". En
genlevering møder en tom tabel og anvender mutationen; en genlevering af et event der
faktisk blev anvendt, preller stadig af på unique-constrainten.

Det bevarer ADR 0027's mønster (række før mutation, constraint som mekanisme) og retter
kun betydningen af rækken. Ingen migration nødvendig.

**Dette gælder alle kommende webhook-ingests**, ikke kun Cal.com. Alunta i fase 3 er den
næste der arver mønstret, og betalingswebhooks er præcis dér et tabt event gør mest skade.

## Konsekvenser

- Positive: idempotens betyder nu "præcis én gang" i den situation der betyder noget.
  Dækket af regressionstests i `tests/integration/meetings.test.ts` (både rollback ved fejlet
  mutation og fravær af rollback ved succes).
- Negative/pris: rollbacken er selv et DB-kald der kan fejle. Sker det, falder vi tilbage
  til den gamle adfærd (tabt event) — men fejlen er da allerede logget til PostHog, og
  situationen kræver to samtidige DB-fejl. Accepteret frem for en migration nu.
- Opfølgning: **den rigtige payload-form og signatur-header fra Cal.com er stadig
  uverificeret** (ingen nøgler). Verificeres i liveverifikationen, se
  `docs/spikes/multi-host.md`.
