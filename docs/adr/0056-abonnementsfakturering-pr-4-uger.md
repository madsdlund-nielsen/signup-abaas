# 0056 — Abonnementsfakturering: periodekæde i Supabase, pris sat på Alunta-abonnementet

- **Status:** Accepteret
- **Dato:** 2026-10-10
- **Fase:** 3 (rework af merget kode, `docs/backlog.md` B-19)
- **Erstatter i kode:** opkrævnings-triggeren fra ADR 0030 (charge pr. afholdt møde) og usage-modellen fra ADR 0032
- **Berører uafklaret punkt:** ja — proratering, opsigelsesvarsel og Alunta-kadence flagges; besluttes ikke her

## Kontekst

ADR 0034 (Mads, 2026-08-26) fastslog at betalingen er et **fast abonnement der forfalder hver
4. uge**, og at prisformlen overlever. Koden opkrævede stadig pr. afholdt møde: `payment_charge`
havde `meeting_id unique`, afholdelses-flippet oprettede grundlaget, og Alunta-adapteren
indberettede forbrug (`reportUsageCharge`) mod en usage-plan.

Ved genlæsning af Aluntas OpenAPI-spec (`https://app.alunta.com/docs/v1/openapi.yaml`, 2026-10-10)
viser det sig at specen er langt bredere end det ADR 0032 beskrev, og at den svarer på det vi
manglede for abonnementsmodellen:

- `checkout.completed` bærer `subscription.uuid` — checkouten **opretter** abonnementet.
- `PUT /subscriptions/{uuid}/price` sætter et flat-rate-abonnements tilbagevendende pris i
  mindste valutaenhed. Default er "næste kommende periode"; kun datoer fra abonnementets
  `available_price_change_dates` er gyldige. Usage- og tier-planer afvises med 422.
- Webhooks har nu et stabilt `webhook_uuid` (rod) og `data.event_id` (pr. transition på
  `invoice.paid`, `checkout.completed`, `subscription.started/ended` m.fl.). ADR 0032 skrev "intet
  stabilt event-id"; det passer ikke længere. Rod-feltet hedder `team_uuid`, ikke `team_id`.
- **Faktureringsintervaller er i måneder — 1/3/4/6/12.** Uger og dage findes hverken på plan,
  abonnement, checkout eller `PUT /subscriptions/{uuid}/interval`.

Det sidste punkt er et reelt problem: **en 4-ugers (28-dages) kadence kan ikke udtrykkes i Alunta.**

## Overvejede muligheder

**Hvor ligger periodekæden (kadencen)?**
- *Alunta bærer kadencen.* Umuligt for 28 dage (se ovenfor) — og ville gøre en leverandør til
  sandhedskilde for hvornår en kunde skylder penge (arkitekturprincip 1).
- *Supabase bærer kadencen* (`payment_charge` pr. periode), leverandøren bærer beløbet og
  opkrævningen. **Valgt.**

**Hvordan kommer beløbet til Alunta?**
- A: abonnement der oprettes ved checkout, hvor vi derefter sætter prisen (`PUT …/price`). **Valgt.**
- B: en engangsfaktura pr. periode (`POST /invoices`, `Idempotency-Key` = `payment_charge.id`).
  Passer perfekt til en 28-dages kæde og fjerner kadence-uoverensstemmelsen, men er ikke et
  abonnement hos leverandøren, og om en engangsfaktura trækkes automatisk på et gemt kort er
  ikke læsbart ud af specen. Et forretnings-/leverandørvalg — **fremlagt, ikke truffet** (B-35).

**Periodeanker (`billing_anchor`)?**
- `membership.created_at` — medlemskabet kan eksistere længe uden kort; man ville opkræve fra en
  dato hvor der intet at trække på var.
- **Datoen (Europe/Copenhagen) kortet registreres** — den dag abonnementet kan begynde at trække,
  og samme dag Alunta opretter sit abonnement. Valgt. Nullable indtil da; sættes **én gang** og
  flyttes aldrig, så genleverede webhooks og senere kort-skift ikke kan forskyde perioderne.

**`meeting_id` på `payment_charge`:**
- Droppe kolonnen — destruktivt for evt. produktionsdata. Afvist.
- **Gøre den nullable og lade unique stå** — gamle pr.-møde-rækker bevarer deres idempotens, nye
  rækker har `meeting_id = null`. Valgt (ikke-destruktivt).

## Beslutning

Migration `0020_subscription_billing.sql` (alt additivt, intet droppet):

- `membership`: `billing_anchor date`, `cancelled_at date`, `provider_subscription_ref text`.
  Tilbagefyldt for eksisterende rækker (anker = oprettelsesdato for dem med kort; opsigelsesdato
  = seneste opdatering for opsagte).
- `payment_charge`: `meeting_id` nullable; `period_start`/`period_end` (`date`, halvåben
  `[start, end)`); `frequency_weeks`/`partner_count` som audit af hvad beløbet blev beregnet ud
  fra; check-constraints (periodepar, rækkefølge, "enten møde eller periode"); og
  **`unique (membership_id, period_start)`** som idempotens — constrainten er mekanismen.
- RLS er uændret: policies hænger på `membership_id`. Ejer ser egne, fremmed ejer/partner/anonym
  ser intet (db-testet på periode-rækker).

Kode:

- **Perioder** — `src/server/charges/periods.ts`, ren funktion: 28 dage fra ankeret i danske
  kalenderdatoer (ikke tidsstempler, så sommertid ikke kan forskyde en grænse). Giver indeværende
  og næste periode; ingen perioder der starter efter `cancelled_at`.
- **Kørsel** — `createChargesForDuePeriods(service, now)` (`src/server/charges/create.ts`):
  for aktive medlemskaber med registreret kort oprettes den periode i dag falder i, beregnet af den
  aktive `pricing_rule` med formlen **uændret** (`(base + n × per_partner) × frekvensfaktor`), på
  boardets rådgiverantal og medlemskabets frekvens **på periodens start**. `pricing_rule_id`,
  `partner_count` og `frequency_weeks` gemmes. Kun *indeværende* periode oprettes: perioder
  kørslen har sprunget helt over efterfaktureres aldrig automatisk (forretningsbeslutning).
- **Synkronisering** — `syncPendingSubscriptions` melder den nyeste afventende periodes beløb til
  leverandørens abonnement (`upsertSubscription`) og flytter rækkerne til `rapporteret`. En
  forbigående API-fejl efterlader `afventer` med årsagen i `failure_reason` (prøves igen næste
  kørsel), aldrig en endelig `fejlet`. Stub aktiv → stopper ærligt.
- **Planlægning** — Netlify scheduled function `netlify/functions/charge-periods.ts` (dagligt, UTC)
  kalder `POST /api/cron/charge-periods` med `x-cron-secret` (`CRON_SECRET`, konstant-tids-
  sammenligning). Uden secret: 503; forkert: 401; flag slået fra: ingen handling. Idempotent.
- **Porten** — `reportUsageCharge` erstattet af `upsertSubscription({ membershipId, customerRef,
  subscriptionRef, amountMinor, currency, intervalDays: 28, startsOn })`. Alunta: `PUT
  /subscriptions/{uuid}/price`; stub kaster `NotConfiguredError`; demo kvitterer `DEMO-SUB-…`.
- **Webhook** — mekanikken (signatur før alt, idempotensrække før mutation, rollback ved fejl,
  ADR 0029) er uændret. Tilføjet: `checkout.completed` kobler også abonnements-uuid og sætter
  `billing_anchor` (kun hvis tom); opsigelse sætter `cancelled_at` (kun hvis tom); idempotensnøglen
  foretrækker `webhook_uuid`, dernæst `data.event_id`, ellers ADR 0032's afledte nøgle.
- **Afholdelses-flippet** rører ikke længere betaling. `createChargeForMeeting` er slettet.
- **`/betaling`** viser abonnementet (beløb pr. 4. uge, frekvens, rådgivere, indeværende periode,
  næste forfaldsdato) og opkrævninger pr. periode; tydelig tekst uden aktiv prisregel.

## Konsekvenser

- Positive: opkrævningen er koblet fra møderne; en periode kan højst opkræves én gang (DB-niveau);
  hver række kan revideres mod regelversion, rådgiverantal og frekvens; gammel data overlever.
- Negative / pris: to lag skal holdes ens — vores 28-dages kæde og Aluntas egen faktureringscyklus.
  Fordi Alunta anvender en prisændring fra sin *næste* periode, kan prisen på Aluntas faktura
  være én periode bagud i forhold til vores `payment_charge`. Det er en del af live-verifikationen.
- `computeMeetingFee`/`MeetingFee` har bevaret navnet (kald brydes ikke); de beregner nu
  beløbet pr. periode. Et senere omdøb er ren hygiejne.
- `getMyMembership`/`getActivePricingRule` har bevaret signaturer; `Membership` har fået valgfrie
  felter (`billingAnchor`, `cancelledAt`).

## Åbent — flagget, ikke besluttet

- 🔴 **Alunta kan ikke fakturere hver 4. uge (Mads, B-35).** Adapteren sender derfor ikke
  `intervalDays` og approksimerer det ikke; kadencen hos Alunta er planens renewal-interval i
  måneder. Valget står mellem (a) en månedlig/4-måneders Alunta-kadence med ejerens accept,
  (b) engangsfaktura pr. periode (mulighed B ovenfor), eller (c) at Alunta har en 28-dages
  mulighed uden for API'et. `// TODO(mads): verificér mod Alunta (live, test_mode)` står i
  `src/lib/payments/alunta.ts`, sammen med at `PUT …/price` aldrig er kørt live.
- **Proratering ved op-/nedgradering midt i en periode** — ikke besluttet. Ingen proratering:
  ændringen slår igennem ved næste periode. `// TODO(ejer)`.
- **Opsigelsesvarsel / refusion** — ikke besluttet. `cancelled_at` afskærer kun nye perioder.
  `// TODO(ejer)`.
- **Efterfakturering af oversprungne perioder** (kørslen nede ≥ 28 dage) — ikke besluttet. `// TODO(ejer)`.
- Moms og fejlet-træk-konsekvens: uændret ejer-territorium.
- `subscription.payment_succeeded`/`started` findes nu i specen og kunne drive statusskift pr.
  periode i stedet for aggregatet på `invoice.paid` — afklares ved live-verifikation (`// TODO(mads)`).
