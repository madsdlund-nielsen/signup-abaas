# 0030 — Alunta-dataflow verificeret: usage-abonnement med øre-parameter

- **Status:** Accepteret
- **Dato:** 2026-08-04
- **Fase:** 3
- **Berører uafklaret punkt:** ja — lukker "Alunta/Supabase dataflow" (§12 pkt. 10, Mads); efterlader gateway-valg, MobilePay-verifikation og priser åbne

> Dataflow-afsøgningen fra ADR 0029 er kørt: Aluntas OpenAPI 3.1-spec
> (`https://app.alunta.com/docs/v1/openapi.yaml`, 10.802 linjer) er gennemlæst, og
> adapteren er skrevet mod den **verificerede** form. Mads leverede docs-adgangen og
> godkendte planen (2026-08-04).

## Verificerede fakta

- Base-URL `https://app.alunta.com/api/v1`; auth `Authorization: Bearer {token}`.
- **Intet synkront kort-træk findes.** `/payments` er read-only (list/reconcile med
  provider-filter). Alunta er en abonnements-/faktureringsplatform.
- **Kortregistrering:** `POST /checkout-sessions` (`type: subscription`, kræver
  `plan_id` + `external_customer_id`) → hosted URL (udløber efter 24 t) → kunden
  gennemfører via kort-gateway → `checkout.completed`-webhook med
  `external_customer_id` + `data.customer.uuid`.
- **Forbrug:** `POST /customers/{uuid}/usage-events` med `parameter` (slug,
  auto-oprettes), `quantity` (counter = delta), `idempotency_key` (unik pr. team i
  ~30 dage; gentagelse → 200 i stedet for 201). Counter-events på en usage-baseret
  plan tælles automatisk mod periodens fakturerbare forbrug; events på allerede
  fakturerede perioder afvises med 422.
- **Faktureringsintervaller er i måneder (1/3/4/6/12) — uger findes ikke.**
- **Webhooks:** header `Signature`, HMAC-SHA256 **hex over rå body**; payload-rod
  `{ event, team_id, timestamp, data, test_mode }`; **intet stabilt event-id**;
  op til 8 genleverancer over ~24 t; 2xx kræves inden 3 sekunder.
- **MobilePay er ikke en Alunta-gateway.** Kort-gateways: OnPay, Stripe, QuickPay;
  "MobilePay" findes kun som manuel betalingsmetode-label. Evt. MobilePay må komme
  via den valgte gateways eget checkout (OnPay/QuickPay tilbyder MobilePay Online) —
  uden for Aluntas API-flade.

## Beslutning — modellen

**Usage-baseret abonnement med øre-parameter:**

1. Én usage-baseret Alunta-plan (opsættes i Alunta-UI) med parameteren
   **`meeting_fee_oere`** til enhedspris 1 øre. `ALUNTA_PLAN_ID` peger på den.
2. Kortregistrering én gang via hosted checkout; `external_customer_id` =
   membership-id. `checkout.completed` kobler Aluntas `customer.uuid` på
   (`membership.provider_customer_ref`) og flipper `card_status` — intet sættes
   optimistisk i actionen.
3. Ved afholdelse indberettes meeting-fee'et som usage-delta **i øre** med
   `idempotency_key = payment_charge.id`. **Vores versionerede `pricing_rule` forbliver
   dermed den autoritative prisberegner** (arkitekturprincip 1) — Aluntas plan bærer
   ingen prislogik, kun opkrævningen.
4. Alunta fakturerer og trækker automatisk pr. periode; `invoice.paid`/
   `invoice.payment_failed` afregner membershipets **rapporterede** charges
   (`payment_charge_status` udvidet med `rapporteret`; `provider_invoice_ref` kobler
   fakturaen). Fakturaen er et periode-aggregat — kobling pr. enkeltmøde findes ikke i
   payloaden, så statusopdateringen rammer membershipets rapporterede charges samlet.
5. `subscription.cancelled`/`ended` → membership `opsagt`. `invoice.created`/
   `refunded`, `subscription.payment_failed` og `customer.usage_recorded` (ekko af
   vores egen indberetning) registreres i idempotens-tabellen uden mutation —
   notifikationer er fase 4. `test_mode` behandles ens (testmiljø-verifikation kræver
   reelle mutationer i testopsætningen).

**Portændring:** `charge()` → `reportUsageCharge()`. Porten skal ikke foregive et
synkront træk der ikke findes. Idempotensnøglen afledes for webhooks som
`event:{primær-uuid}:{timestamp}` (samme greb som Cal.com, ADR 0027) — Alunta sender
intet event-id.

**⚠ Ærlig nuance ift. byggespec §4** (*"Betaling trækkes ved afholdelse af møde"*):
trækket **udløses** ved afholdelse (usage-event) men **opkræves** på periodens
automatiske faktura — et øjeblikkeligt pr.-møde-kort-træk findes ikke i Alunta.
Alternativet (`one_off_invoice` pr. møde) er et betalingslink kunden selv skal klikke
på, hvilket bryder §4's "trækkes automatisk". Usage-modellen er den eneste automatiske.
**Ejerne bør orienteres:** kunden oplever en samlet periodefaktura, ikke et træk pr. møde.

## Konsekvenser

- **Positive:** dataflow-punktet er lukket; dobbelt-indberetning er umulig i to lag
  (vores `meeting_id unique` + Aluntas `idempotency_key`); prislogikken bor ét sted
  (versioneret, auditerbar); webhook-kernen var allerede korrekt i form — kun
  header-navn og payload-parse skiftede.
- **Negative / pris:** charge-status er blevet et fire-trins-forløb
  (afventer → rapporteret → gennemført/fejlet); faktura-til-møde-kobling er
  aggregeret, ikke pr. række; §4-nuancen skal godkendes af ejerne.
- **Restpunkter:**
  - **Opsætning i Alunta-UI (Mads):** usage-baseret plan + parameter
    `meeting_fee_oere` (enhedspris 1 øre) + webhook-URL/-secret + valg af
    faktureringsinterval (fx månedligt) → `ALUNTA_PLAN_ID`/`ALUNTA_API_KEY`/
    `ALUNTA_WEBHOOK_SECRET` i Netlify.
  - **Gateway-valg (Mads/ejer):** OnPay vs. Stripe vs. QuickPay — afgør gebyrer OG
    om MobilePay kan tilbydes (via gatewayens checkout).
  - **Live-verifikation i `test_mode`:** checkout → kobling → usage-event synligt i
    Alunta → periodefaktura → `invoice.paid` → charges `gennemfoert`.
  - Priser/moms/fejlet-træk-konsekvens: uændret ejer-territorium.
