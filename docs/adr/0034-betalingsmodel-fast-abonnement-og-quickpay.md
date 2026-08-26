# 0034 — Betalingsmodel: fast abonnement hver 4. uge, gateway = QuickPay

- **Status:** Accepteret
- **Dato:** 2026-08-26
- **Fase:** 3
- **Erstatter opkrævnings-triggeren i:** ADR 0030 (charge pr. afholdt møde) og ADR 0032 (usage-abonnement)
- **Berører uafklaret punkt:** ja — lukker gateway-valget og MobilePay-spørgsmålet; **ændrer** betalingsmodellen

## Kontekst

To beslutninger fra Mads (2026-08-26), truffet efter at fase 3 var bygget og merget.

**1. Betalingsmodellen.** Fase 3 blev bygget som *usage*: et `payment_charge` pr. **afholdt
møde**, prissat ved afholdelses-flippet og indberettet til Alunta som usage-event
(ADR 0030 + 0032). Det fulgte CLAUDE.md's daværende ordlyd — *"kort registreres ved
booking, træk sker ved afholdelse"*.

Den faktiske forretningsmodel er en anden: **et fast abonnement pr. kunde, der forfalder
hver 4. uge** — ikke månedligt, ikke årligt. Abonnementets *størrelse* afhænger af antal
rådgivere på boardet og mødefrekvensen (4/8/12 uger).

Prisformlen er dermed uændret — `(grundpris + n_rådgivere × pris_pr_rådgiver) × frekvensfaktor`
er præcis "afhænger af antal rådgivere og mødefrekvens". Det der ændrer sig er **triggeren**:
fra "når et møde afholdes" til "hver 4. uge, uanset". De to falder først fra hinanden når et
møde aflyses, udebliver, eller boardet ligger stille — og dér opkræver abonnementsmodellen,
hvor usage-modellen ikke gør.

**2. Gateway.** ADR 0032 fastslog at MobilePay ikke er en Alunta-gateway; kortbetaling går
via OnPay, Stripe eller QuickPay, og valget afgør både gebyrer og om MobilePay kan tilbydes.

## Overvejede muligheder

**Gateway:**
- **Stripe** — global rækkevidde, men amerikansk databehandler; ville trække GDPR-billedet
  tilbage til dét vi netop forlod med Alunta og Ordbogen, og tilbyder ikke MobilePay på
  samme måde i DK.
- **OnPay** — dansk, tilbyder MobilePay Online.
- **QuickPay** — dansk, tilbyder MobilePay Online. **Valgt** (Mads).

**Betalingsmodel:** ikke en teknisk afvejning — det er forretningens model. Den er
registreret her, ikke besluttet her.

## Beslutning

**1. Opkrævningen er et fast abonnement der forfalder hver 4. uge.** Beløbet beregnes af
den aktive `pricing_rule` ud fra boardets rådgiverantal og mødefrekvens, og opkræves i fast
kadence uanset om der blev afholdt møde i perioden.

**2. Kort-gateway er QuickPay**, konfigureret bag Alunta. MobilePay tilbydes gennem
QuickPays checkout (MobilePay Online). Begge dele skal **liveverificeres** mod rigtige
konti før produktion — QuickPay-konto findes endnu ikke.

## Konsekvenser

- Positive: modellen er enklere end usage — ingen kobling pr. møde, ingen indberetning af
  forbrug, og fakturaen er forudsigelig for kunden. Prisreglen og dens versionering
  (ADR 0030) overlever uændret; **kun triggeren udskiftes**. Gatewayen er dansk, så
  GDPR-billedet forbliver EU/DK hele vejen.
- **Negative/pris — dette er rework af merget kode.** Konkret rammer det:
  - `payment_charge` med `meeting_id unique` (migration 0013) er modelleret pr. møde og
    passer ikke til en periodisk opkrævning.
  - `src/server/charges/create.ts` opretter grundlag ved afholdelses-flippet
    (`src/server/meetings/actions.ts`) — den kobling skal væk.
  - `AluntaPaymentProvider.reportUsageCharge()` og usage-planen med parameteren
    `meeting_fee_oere` (ADR 0032) erstattes af et abonnement med en pris.
  - `/betaling` viser en opkrævningsliste pr. møde.

  Arbejdet er **ikke** udført i denne ADR's PR: `FLAG_PAYMENTS` er slået fra, ingen
  prisregel findes, og ingen Alunta-nøgler er sat — modulet kan ikke opkræve nogen.
  Sporet som `docs/backlog.md` **B-19**, og det skal ske før betaling går live.
- Opfølgning: ADR 0030 og 0032 er annoteret. Alunta-planen skal oprettes som et
  **abonnement med 4-ugers interval**, ikke som usage-plan — `docs/accounts-to-create.md`
  er rettet tilsvarende.
