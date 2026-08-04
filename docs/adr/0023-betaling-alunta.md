# 0023 — Betaling ind: Alunta

- **Status:** Accepteret
- **Dato:** 2026-08-03
- **Fase:** 2 (besluttet før fase 3 bygges)
- **Berører uafklaret punkt:** ja — lukker "Alunta vs. Stripe Billing"; efterlader dataflow, MobilePay og priser åbne

> **Beslutningen er Mads'.** Denne ADR dokumenterer den og dens tekniske konsekvenser,
> jf. ADR-on-decision i CLAUDE.md — den træffer den ikke.

## Kontekst

Betalingslaget har siden fase 0 stået som `Stripe + MobilePay` med *"⚠ Alunta
undersøges som alternativ"* i CLAUDE.md. Byggespec §7 lister Alunta som
*"Potentiel alternativ til Stripe Billing (dansk udbyder)"* med status **Undersøges**,
og §12 punkt 11 gør valget til et Mads-punkt.

Porten `src/lib/payments/` blev bygget leverandørneutral i fase 0 (ADR 0004) og har
kørt som stub siden — ingen adapter er skrevet, og `FLAG_PAYMENTS` er OFF. Valget
skulle derfor træffes inden fase 3, men har ikke blokeret noget hidtil.

Forretningsmodellen stiller et konkret krav: **varierende betalingsfrekvenser** —
kort registreres ved booking, træk sker ved afholdelse, med frekvensvalg 4/8/12 uger
(CLAUDE.md). Det er et abonnements-lignende mønster med uregelmæssig trækkadence.

## Overvejede muligheder

- **Stripe Billing** — bredt understøttet, men et abonnementslag hvis kadence er
  bundet til faste intervaller frem for til afholdte møder.
- **Alunta** — dansk udbyder, positioneret som abonnementslag (byggespec §7).
- **Alunta oven på Stripe** — Alunta som abonnementslag med Stripe som gateway.

## Beslutning

**Alunta.** Erstatter Stripe Billing som betalingsleverandør ind.

Teknisk følger:

- **Portens interface ændres ikke.** `src/lib/payments/` forbliver leverandørneutral
  (ADR 0004) — opret kunde, registrér kort, træk beløb, opsig, opgradér. Alunta bliver
  én adapter bag den, ikke en ny abstraktion. Et senere skifte forbliver dermed en
  implementeringsdetalje.
- **Adapteren bygges i fase 3.1**, aktiveret af `FLAG_PAYMENTS` + Alunta-nøgler. Uden
  dem forbliver stubben aktiv, og den **kaster** frem for at foregive succes
  (`docs/stub-politik.md`).
- **Webhooks skal signaturverificeres og være idempotente** (fase 3.5). Ingen af
  delene må stubbes — et dobbelttræk er ikke en fejl man opdager i test.
- `.env.example` og `docs/accounts-to-create.md` opdateres når Alunta-nøglernes navne
  kendes; `STRIPE_*`-variablerne udgår ved samme lejlighed.

## Konsekvenser

- **Positive:** dansk udbyder forenkler GDPR-billedet; leverandørvalget er lukket, så
  fase 3 kan bygges uden at vente; portmønstret gør skiftet fra Stripe gratis, fordi
  ingen Stripe-adapter nåede at blive skrevet.
- **Negative / pris:** Stripe er den bedre dokumenterede platform, og økosystemet
  omkring Alunta er mindre. Skulle Alunta vise sig utilstrækkeligt, koster det én
  adapter at skifte tilbage — ikke domænekode.
- **Åbent efter denne beslutning:**
  - ⚠ **MobilePay gennem Alunta (Mads)** — understøttelsen følger ikke automatisk med
    valget og skal verificeres, før fase 3.4 kan bygges færdig.
    `// TODO(mads): MobilePay via Alunta`.
  - ⚠ **Alunta/Supabase-dataflow (Mads)** — kortregistrering, varierende
    betalingsfrekvenser, webhooks og signaturverifikation skal verificeres mod
    GDPR-arkitekturen fra fase 0 før produktionsbrug. DPA skal underskrives.
  - 🔴 **Priser (ejer)** — startpris/meeting-fee og honorarsats er stadig uafklarede.
    De blokerer ikke byggeriet af regelmotoren, kun tallene i den.
