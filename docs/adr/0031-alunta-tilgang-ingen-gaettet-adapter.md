# 0031 — Alunta-tilgangen: omdøbt config og webhook-skelet, ingen gættet adapter

> **Opfølgning lukket (2026-08-04):** dataflow-afsøgningen er kørt — se **ADR 0032**.
> Adapteren er skrevet mod den verificerede spec, og det provisoriske webhook-skema er
> erstattet af den verificerede form.

- **Status:** Accepteret
- **Dato:** 2026-08-04
- **Fase:** 3
- **Berører uafklaret punkt:** ja — udfører ADR 0023's oprydning; Alunta-dataflow og MobilePay forbliver Mads-punkter

## Kontekst

ADR 0023 valgte Alunta og varslede at `STRIPE_*`-env-vars udgår "når Alunta-nøglernes
navne kendes". Fase 3 bygger betalingsmekanikken — men **Aluntas API er uafsøgt**:
dataflow-afsøgningen (§12 pkt. 10) er et åbent Mads-punkt, og der findes ingen offentlig
API-dokumentation at kode imod, modsat Cal.com i fase 2 (kendt API v2, hvor kun
feltmapping stod til liveverifikation).

Stub-politikken forbyder gæt der ligner svar. En Alunta-adapter skrevet mod et opdigtet
API ville være præcis det.

## Overvejede muligheder

- **A — konkret adapter mod gættet API:** som Cal.com-tilgangen, men uden dokumentation
  bag; alt ville skulle skrives om efter afsøgningen.
- **B — stub + omdøbt config; adapteren er dataflow-afsøgningens leverance.**
- **Webhook:** vente helt vs. bygge endpointet nu med ADR 0027-mønstret og provisorisk
  payload-form.

## Beslutning

**B.** Konkret:

- `src/lib/payments/index.ts` omdøbt: `ALUNTA_API_KEY`, `ALUNTA_WEBHOOK_SECRET`;
  `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`MOBILEPAY_MERCHANT_ID` er fjernet fra
  config, `.env.example` og `docs/accounts-to-create.md`. Stub-vendor er "alunta".
  **Stubben forbliver aktiv selv med flag+nøgle** (den udkommenterede adapter-linje er
  bevidst) — testen `payments.test.ts` låser adfærden fast, så ingen tror at nøgler
  alene tænder betaling.
- **Porten forbliver `registerCard` + `charge`.** ADR 0023 nævnte "opsig, opgradér" —
  de udgår bevidst: med træk-pr-afholdelse (§4) findes intet abonnement hos
  leverandøren. Op-/nedgradering og opsigelse er membership-operationer i Supabase
  (ADR 0030), og et provider-kald ville være en operation uden modtager.
- **`/api/webhooks/alunta` bygges nu** med ADR 0027-mønstret (rå body → HMAC
  konstant-tid → idempotensrække før mutation → mutér; manglende secret → 503).
  Kernen (`src/server/charges/webhook.ts`) er leverandørneutral; **header-navn,
  signaturformat og event-form er provisoriske** og samlet i den fil, så
  dataflow-afsøgningens justering er lokal. Webhooken opdaterer kun status
  (charge gennemført/fejlet, kort registreret) — den opretter aldrig data.
- Kortregistrerings-semantikken (kunde-oprettelse vs. checkout-session; hvornår
  `card_status` flipper) fastlægges i afsøgningen — flippet sker via webhooken, ikke
  optimistisk i actionen.

## Konsekvenser

- **Positive:** ingen fantasi-kode der ligner en integration; hele mekanikken omkring
  porten (grundlag, processering, webhook, UI) er bygget og testet, så afsøgningen kun
  skal levere selve adapteren + verificere webhook-formen; Stripe-resterne er ryddet.
- **Negative / pris:** betaling kan ikke aktiveres ved blot at sætte nøgler — adapteren
  skal skrives først. Det er bevidst: et synligt hul frem for et gæt.
- **Opfølgning (Mads, §12 pkt. 10):** dataflow-afsøgning → `AluntaPaymentProvider`,
  verificeret webhook-form, MobilePay-verifikation, GDPR-gennemgang af kortdataflow.
  ADR skrives når afsøgningen er kørt (samme mønster som multi-host-spiken).
