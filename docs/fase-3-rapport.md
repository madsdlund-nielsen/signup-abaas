# Fase 3 — rapport: leverancer, modelrettelse og betinget lukning

> Hvad fase 3 leverede, hvad der er verificeret, hvad kodegennemgangen fandt — og hvorfor
> fasen lukkes **betinget** med ét kendt, registreret afvig. Samme form som
> `docs/fase-0/1/2-rapport.md`.
>
> Lukket (betinget) 2026-08-26. **Opdatering 2026-10-10:** modelrettelsen B-19 er leveret
> (ADR 0056) — se §5. Tekst i §1-§4 beskriver fase 3 som leveret dengang (pr. afholdt møde).

## 1. Hvad Fase 3 leverede (🟢)

| Arbejdspakke | Leverance |
|---|---|
| **Datamodel** | Migration `0013`: `membership` (én pr. board), `pricing_rule` (**append-only versioner**, højst én aktiv via partial unique index), `payment_charge`, `payment_webhook_event`. Migration `0014`: status `rapporteret` + `provider_invoice_ref`. **Partnere ser aldrig betalingsdata** — RLS-testlåst. |
| **Prisregler** | `/admin/priser` med preview inden gem. Versionerede regler i databasen; **ingen beløb i kode nogen steder**. |
| **Prisberegner** | `computeMeetingFee` — `(grundpris + n_rådgivere × pris_pr_rådgiver) × frekvensfaktor`. Delt `PriceBreakdown` mellem admin-preview og ejer-flow, så admin ser præcis det kunden ser. |
| **Alunta-adapter** | `AluntaPaymentProvider` skrevet mod den **verificerede** OpenAPI-spec (ADR 0032), ikke gættet. Rå `fetch`, ingen SDK. Rene request-byggere, unit-testet. |
| **Webhook** | `POST /api/webhooks/alunta` — `Signature`-header, HMAC-SHA256, idempotens via `payment_webhook_event`. Alle ni event-typer mappet. |
| **UI** | `/betaling` (pris, medlemskab, kortregistrering, frekvensskift, opkrævningsliste) · `/board` op-/nedgradering med invariant. |

## 2. Verifikation

| Gate | Status |
|---|---|
| `npm run lint` · `check` · `build` | 🟢 |
| `npm run test:coverage` | 🟢 123 tests, 75,2 % |
| `npm run test:integration` | 🟢 33 tests |
| `npm run test:db` (RLS, positive **og** negative) | 🟢 i CI — kan ikke køres lokalt (`docs/backlog.md` B-13) |
| `npm audit` | 🟢 0 sårbarheder |

Idempotens er bevist i tre lag: afholdelses-flippets guard, `meeting_id unique` på
`payment_charge`, og webhook-eventtabellens unique-constraint.

## 3. 🔴 FLAG — uafklarede punkter rørt i Fase 3

| Punkt | Status |
|---|---|
| Startpris, pris pr. rådgiver, frekvensfaktorer | **Ingen aktiv prisregel findes.** Strukturen er bygget, tallene indtastes af admin. Beregning og opkrævning er slået fra indtil da — et synligt hul, ikke en fejl. |
| Moms på beløb | Beløb er rå øre uden momslogik (§12 pkt. 14). |
| Fejlet træk → konsekvens | Registreres med status + årsag, uden konsekvens for honorar eller adgang. §5.10 udløser honorar uafhængigt af betaling; koblingen er uafklaret. |
| Prisregel-pinning for eksisterende aftaler | Spec-tro default: ny pris gælder fra næste opkrævning. Versionsreferencen på `payment_charge` gør pinning mulig senere. |

## 4. Fund undervejs — kodegennemgang

**🔴 Alunta-webhooken kunne tabe betalings-events permanent.** Fase 3 blev skrevet før
ADR 0029 og arvede præcis det mønster 0029 rettede for Cal.com: idempotensrækken skrives
før mutationen, og en fejlet mutation svarer `500` **uden at rulle rækken tilbage**. Aluntas
genlevering ramte så unique-constrainten og kvitterede `200 — allerede behandlet`; eventet
var tabt for altid. Konkret: en tabt `invoice.paid` efterlader en kunde der **har** betalt
som ubetalt, og en tabt `subscription.cancelled` lader os fakturere en opsagt aftale videre.

Rettet i `fail()`-stien med regressionstests begge veje. Fundet fordi ADR 0029 eksplicit
advarede om at fase 3 ville arve mønstret — men advarslen blev skrevet efter koden.

## 5. Betinget lukning — modellen er ændret efter byggeriet

Fase 3 blev bygget som **usage**: et `payment_charge` pr. afholdt møde, indberettet til
Alunta som usage-event. Det fulgte CLAUDE.md's daværende ordlyd (*"træk sker ved afholdelse"*).

**Den rigtige model er et fast abonnement der forfalder hver 4. uge** (Mads, 2026-08-26 —
**ADR 0034**). Prisformlen overlever uændret; det er **triggeren** der er forkert.

Fasen lukkes derfor betinget, med afviget navngivet frem for skjult:

- **DoD-punkt 5 er omskrevet**, ikke afkrydset — kriteriet beskrev den gamle model.
- **Rework spores som `docs/backlog.md` B-19** og skal ske før betaling går live.
  **→ Leveret 2026-10-10 (ADR 0056):** opkrævning pr. 28-dages periode i stedet for pr. møde,
  planlagt kørsel, abonnements-adapter, `/betaling` pr. periode. DoD-punkt 5 er nu afkrydset.
  Ved genlæsning af Aluntas spec fandtes at **Alunta kun fakturerer i måneder** (B-35, Mads).
- Det haster ikke for MVP'en: `FLAG_PAYMENTS` er slået fra, ingen prisregel findes, ingen
  Alunta-nøgler er sat. **Modulet kan ikke opkræve nogen.**

Derudover udestår liveverifikation mod rigtige konti — Alunta og QuickPay findes endnu ikke.
Checklisten står i **§7** og er en gate før produktion, ikke før fase 4.

## 6. Blokerer produktion — ejer/Mads

- **Prisregler** — Andreas og Mette skal fastlægge satserne; uden dem kan intet beregnes.
- ~~B-19 — modelrettelsen fra usage til 4-ugers abonnement~~ → leveret (ADR 0056).
- **B-35** — Alunta kan ikke fakturere hver 4. uge (kun måneder): vælg kadence-løsning.
- **Alunta-DPA + QuickPay-DPA** — `docs/gdpr/leverandoer-register.md`.
- **Netlify Functions-region = EU** — uændret fra fase 1.
- **§4-nuancen:** kunden ser én samlet periodefaktura, ikke et træk pr. møde. **Ejerne bør
  godkende det eksplicit** — det ændrer hvad kunden oplever.

## 7. Liveverifikations-checkliste — GATE FØR PRODUKTION

Kan først køres når Alunta- og QuickPay-konti findes. Ingen af punkterne må krydses af på et
skøn. Kør i **test_mode** først.

| # | Skal verificeres | Rammer |
|---|---|---|
| P-1 | Alunta-planen oprettet som **flat-rate-abonnement** (ADR 0034/0056), ikke usage-plan. 🔴 Intervallet i Alunta er i **måneder** — 4-ugers findes ikke (B-35) | `ALUNTA_PLAN_ID` |
| P-2 | Checkout-session → kortregistrering → `checkout.completed` kobler membership ↔ Alunta-kunde **og abonnement** (`subscription.uuid`) og sætter `billing_anchor` | `webhooks/alunta/route.ts` |
| P-9 | `PUT /subscriptions/{uuid}/price` accepteres for planen, og prisændringen træder i kraft i Aluntas næste periode (kan ligge én periode bagud ift. vores `payment_charge`) | `lib/payments/alunta.ts` |
| P-10 | Netlify scheduled function `charge-periods` kører (dagligt, `CRON_SECRET` sat) og en dobbeltkørsel ikke giver dubletter | `netlify/functions/charge-periods.ts` |
| P-3 | **Signatur-header og -algoritme**: at headeren hedder `Signature` og er HMAC-SHA256 hex over rå body | `verifyAluntaSignature` |
| P-4 | **Genlevering:** at Alunta faktisk genleverer ved ikke-2xx (op til 8 gange/~24 t) — ADR 0029's rollback hviler på det | `webhooks/alunta/route.ts` |
| P-5 | `invoice.paid` afregner de rigtige charges; `invoice.payment_failed` sætter årsag | `charges/webhook.ts` |
| P-6 | **QuickPay som gateway** virker bag Aluntas checkout | Alunta-UI |
| P-7 | **MobilePay Online** aktiveret på QuickPay-kontoen og synlig i checkout (ADR 0032/0034) | Alunta-UI |
| P-8 | `test_mode`-events muterer i dag produktionsdata på lige fod med rigtige. Beslut om produktion skal **afvise** `test_mode: true` efter verifikationen | `charges/webhook.ts` |

## 8. Næste skridt

Fase 4 (forberedelse, rating, AI, notifikationer) er den mest konto-blokerede fase i planen:
Ordbogen-DPA er uunderskrevet, og der findes hverken Resend- eller inMobile-konto. Med launch
i januar 2027 er der rigelig plads — men fasen bør ikke startes for at producere stubs.

Nærmeste værdi ligger i at få stakken til at køre end-to-end mod rigtige nøgler
(`docs/opsaetning-ejer-test.md`) og køre Cal.com-liveverifikationen
(`docs/spikes/multi-host.md`).

> **Trukket tilbage 2026-09-14 (ADR 0042).** Anbefalingen om ikke at starte fase 4 før konti
> findes, var det gamle loop: skærmen ventede på leverandøren. Nu bygges skærmene mod
> demo-adapterne (ADR 0041), og leverandøren droppes ind bagefter.
