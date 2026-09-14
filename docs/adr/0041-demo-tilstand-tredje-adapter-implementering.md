# 0041 — Demo-tilstand: tredje adapter-implementering ved siden af rigtig og stub

- **Status:** Accepteret
- **Dato:** 2026-09-14
- **Fase:** løbende (udvider ADR 0004)
- **Berører uafklaret punkt:** nej. Demo-værdier er åbenlyst falske og træffer ingen af ejerens beslutninger — se data-reglen.

## Kontekst

ADR 0004 gav hver sub-processor en port med to implementeringer: den rigtige (når flag +
nøgler er sat) og en stub der kaster `NotConfiguredError`. Det holdt appen bygbar og ærlig
uden konti. Men i september 2026 er alle ni moduler stadig stub-aktive, og seks af dem
kaster: ejerrejsen stopper ved *book møde*, *registrér kort* og *Deltag*. Ingen — hverken
Mads eller ejerne — kan klikke produktet igennem. Konsekvensen er beskrevet i ADR 0042:
når man ikke kan klikke, må man forudsige, og det er langsomt.

Mads' krav (2026-09-14): noget mere *færdigt* at klikke rundt i, designe på og prøve
funktioner i — også hvor funktionen bag knappen stadig er en dummy. Produktionskode, ikke
prototype: intet smides væk.

## Overvejede muligheder

- **Vent på nøglerne.** Ærligt, men det er status quo: Cal.com-, Alunta- og Ordbogen-adgang
  har været undervejs siden juni. Rejsen forbliver uklikbar indtil da.
- **Lad stubben returnere noget plausibelt.** Forbudt af stub-politikken, og med rette: et
  plausibelt svar flytter fejlen fra byggetid til en faktura.
- **En tredje implementering pr. port — demo — der virker og er åbenlyst falsk.** Vælges
  kun når den rigtige config mangler. Beholdes efter launch til salgsdemoer, onboarding
  og designarbejde. **Valgt.**

## Beslutning

Hver backend-port får `src/lib/<modul>/demo.ts` med en `Demo<X>Provider` (`name = "demo"`).
Factoryen i `index.ts` får én linje, indsat **efter** den rigtige provider:

```ts
if (isEnabled("booking", env) && isConfigured(config)) return new CalComBookingProvider(…);
if (isDemoMode(env) && !isConfigured(config)) return new DemoBookingProvider();
return new StubBookingProvider();
```

`isDemoMode()` (`src/server/flags`) læser `FLAG_DEMO`. Den er bevidst ikke et `FeatureFlag`:
den tænder ikke et modul, den vælger en implementering.

**Sikkerhedsreglen.** Demo vælges kun når rigtig config *mangler*. Rigtige nøgler vinder
altid, uanset `FLAG_DEMO`. Demo kan derfor aldrig skygge for en ægte integration, heller
ikke ved en glemt env-variabel. `tests/integration/adapters.test.ts` beviser det (case b).

**Data-reglen.** Alt demo returnerer er åbenlyst falsk: referencer bærer `DEMO-`, tekster
starter med `[DEMO]`, og ingen demo-værdi lever i kode som default. Stub-politikkens forbud
gælder *plausible* placeholders; en værdi ingen kan forveksle med en beslutning er ikke en
placeholder. De fem integritetsgrænser (autorisation, RLS, webhook-signatur, idempotens,
samtykke) demo'es aldrig — demoen erstatter leverandørkald, ikke sikkerhedsgrænser.

**Hvor demoen lander.** To af demoerne skal pege et sted hen, og de peger ind i appen:

- Booking/video → `/moeder/rum/[ref]` — et møderum der er en side i appen, så "Deltag" kan
  designes på. `ref` er booking-uid'et (booking-adapteren kender ikke mødets id) eller
  mødets id; læsningen er RLS-scopet som alle andre mødesider.
- Betaling → `/betaling/demo-kort/[membershipId]` — en demo-checkout uden kortfelter, hvis
  ene knap udfører præcis checkout.completed-webhookens tilstandsskift (`confirmDemoCard`).
  Den afvises medmindre demo-provideren er den aktive — rigtige nøgler lukker den.

Fire-and-forget-portene (email, sms, analytics) rører vi ikke: de logger og resolver allerede.

Synligt overalt: `DemoBadge` i headeren på hver side når `FLAG_DEMO` er sat. Dæmpet hvid,
ikke guld — det sidder på alle sider og må ikke bruge guldbudgettet (ADR 0039).

## Konsekvenser

- Positive: ejerrejsen fra signup til rating kan klikkes igennem uden én
  `NotConfiguredError` — på sua-abaas.netlify.com, ikke kun lokalt. Skærme til det der
  udestår kan bygges skærm-først (ADR 0042). Demoen har varig værdi efter launch.
- Negative/pris: seks små klasser at vedligeholde når portene ændrer sig; én ekstra
  driftstilstand at holde styr på. **`FLAG_DEMO` SKAL være slået fra ved launch** — føjet
  til fase 6 §6.4.
- Opfølgning: demo-seed'et udvides til en befolket tilstand (før/efter-skærme) i næste PR.
  `FLAG_DEMO=true` sættes i Netlify af Mads. `docs/stub-politik.md` og
  `docs/stub-register.md` er opdateret i denne PR.
