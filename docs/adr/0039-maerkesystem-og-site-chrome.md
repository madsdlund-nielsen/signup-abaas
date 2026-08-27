# 0039 — Mærkesystemet i UI'et + site-chrome

- **Status:** Accepteret
- **Dato:** 2026-08-27
- **Fase:** løbende (design er acceptkriterium, ikke en fase)
- **Berører uafklaret punkt:** ja — designmanualens kolofon rummer fire **brandpunkter** der
  ikke er vores at afgøre. De er flaget nedenfor, ikke besvaret.

## Kontekst

Ejerne dømmer platformen på om den føles high-end; CLAUDE.md gør UI/UX til et acceptkriterium
på linje med sikkerhed. Indtil nu havde vi tokens og et komponentlag, men ingen anvendelse:

- **Forsiden var et fase 0-skelet.** Den fortalte besøgende at "dette skelet etablerer
  design-tokens, adapter-laget for sub-processorer, feature-flags og RBAC/RLS" — intern
  udviklertekst på hoveddøren.
- **Ingen mærker i UI'et.** `public/brand/` indeholdt kun `lockup-03.svg`, som designmanualen
  udtrykkeligt **ikke** har optaget i systemet.
- **Ingen header, ingen fod.** Manualens fjerde kanoniske form — header-baren — fandtes ikke.
- **Sektionsrytmen var ubrugt.** `SectionBand` eksisterede, men hver side var én hvid kolonne.
  Manualen kalder rytmen bærende: "skiftet bærer siden".

Grundlaget var derimod i orden: `docs/design-tokens.css` er **1:1 med designmanual v1.2** —
hver farve, overlay, typetrin, spacing-værdi, radius og bredde matcher. Der var intet at rette
i tokens.

## Overvejede muligheder

**Mærkevalg i headeren:**
- **Ordmærket (lockup-22) altid** — manualens kanoniske header. Men løsen må ikke sættes under
  300 px bredde, og en header skal virke på en telefon.
- **Kortformen altid** — virker i alle bredder, men opgiver ordmærket på det ene sted hvor der
  er plads til det, og manualen foreskriver løsen i headeren.
- **Skift ved skalagrænsen** — løsen fra 720 px viewport, kortform derunder.

**Skiftets mekanik:** CSS-baseret (begge i DOM'en) vs. JS-baseret (måler og vælger).

## Beslutning

**Hele mærkesystemet ind i `public/brand/`** — ordmærket `lockup-22` plus kortform 01
(Light + SemiBold) og kortform 05, hver i lys og navy variant. Alle er outline-kurver med
farver identiske med tokens. `public/brand/README.md` bærer skalatabellen, så mærkevalget kan
slås op frem for gættes.

**Mærkevalg er en beregnet grænse, ikke en smagssag.** Hvert mærke har ét bindende element —
den tyndeste streg — og grænsen ligger hvor den rammer én pixel. Under grænsen renderer stregen
gråt frem for at fejle synligt, og derfor er reglen skrevet ned tre steder: i brand-README'en, i
komponenternes kommentarer, og som en test der fejler hvis fod-mærket sættes under 320 px.

**Headeren skifter mærke ved 720 px viewport.** Over: ordmærket i 300 px, dets minimum. Under:
kortform 01 SemiBold i 40 px, midt i dens 32–96 px-interval. Begge ligger i DOM'en, og CSS
vælger — et JS-baseret skift ville give et synligt hop ved hydrering på hver sideindlæsning.
Skiftet er en konsekvens af manualens egne skalagrænser, ikke en layoutpræference.

**`charcoal` tilføjet som båndtone.** Manualen tildeler charcoal hero, header-bar og
fotobaggrunde, og navy sektionsbånd og paneler. De to er ikke ombyttelige, så tonen skulle
findes for at heroen kunne være korrekt.

**Forsiden er bygget om på sektionsrytmen** — charcoal hero → hvid → lysegrå → navy. Guld
optræder på eyebrows og CTA'er og intet andet, hvilket holder accenten inden for manualens
budget på ca. 5 % af fladen. Foden bruger kortform 05 som afsender.

### Manualen slår handoff-bundtet ved uenighed

Logo-handoff-bundtet sætter kortform 01 Lights nedre grænse ved **80 px**; designmanual v1.2
sætter den ved **96 px** og begrunder korrektionen: ved 80 px er stregen 1,06 px og fordeles
over to pixelkolonner med halv dækning hver, så den renderer gråt; ved 96 px er den 1,28 px og
lander rent. **Vi følger manualen** — den er senere, den er den autoritative kilde, og dens
begrundelse er efterprøvelig. Bundtet er en arbejdsproces, ikke en specifikation.

## Konsekvenser

- Positive: platformen har for første gang et ansigt der matcher brandet. Mærkerne kan ikke
  bruges forkert ved et uheld, fordi skalareglerne står ved siden af filerne og er testet.
  Manualens do/don't er overholdt: intet rundt, ingen gradienter, ingen skygger på knapper,
  tynde store overskrifter, guld sparsomt.
- Negative / pris: **alle ruter er nu dynamiske.** Headeren læser session for at vise den
  rigtige navigation, så forsiden gik fra statisk til server-renderet pr. forespørgsel. Det er
  en reel omkostning på et Netlify-abonnement, og den kan rulles tilbage ved at gøre headeren
  auth-uvidende — på bekostning af at vise "Log ind" til en der allerede er logget ind.
- Negative: foden er høj, fordi kortform 05's 512-felt ikke må beskæres. Luften er mærkets, og
  vi vælger at respektere den frem for at klippe.
- Opfølgning — **brandpunkter til ejer, ikke tekniske valg:**
  - 🔴 TODO(ejer): navnelinjens farve i kortform 05. `#4E4E4E` på lys, hvid på mørk. På lys
    træder navnet tilbage, på mørk gør det ikke. Filerne bærer i dag begge forhold. Vælg ét.
  - 🔴 TODO(ejer): `lockup-03` er ikke optaget i manualen og bruges ikke. Afklar dens status,
    eller slet filen.
  - 🔴 TODO(ejer): linkfarven `#1E73BE` er WordPress-temaets standardblå — den eneste værdi i
    paletten uden brandbegrundelse.
  - 🟡 Det lille snit fylder 69 % af kvadratet; ved 32 px lander stregen på 0,88 px. Ved 78 %
    rammer den 1,00 px. Kræver en ny tegning, ikke en CSS-ændring.
  - ~~De signerede ruter er endnu ikke bygget om~~ → **lukket samme dag**, se opdateringen
    nedenfor.

## Opdatering (2026-08-27) — designsproget ført igennem de signerede sider

De 19 signerede sider stod på `<main className="container stack">`: én hvid kolonne med
eyebrow, overskrift og indhold. Funktionelt, men uden komposition.

**At pakke dem i forsidens `SectionBand` ville have været forkert.** Båndrytmen med 90 px luft
er et redaktionelt greb; en app-flade skal orientere hurtigt, ikke læses som en brochure. I
stedet er der indført tre mønstre, alle på eksisterende tokens:

| Mønster | Hvad | Hvorfor |
|---|---|---|
| `PageHeader` + `PageBody` | Kompakt **navy** sidehoved med brødkrumme, tynd overskrift og underrubrik; indhold på hvidt under | Manualens kontrast bærer også app-fladen, men med `--space-6` i stedet for `--space-section` — et sidehoved er orientering, ikke en sektion, og 90 px ville skubbe indholdet under folden på hver side |
| `.panel` | Bokset hvidt panel med `--shadow-panel` | Manualens **eneste** legitime brug af skygge. Grupperer uden at støje |
| `.focus-page` | Charcoal flade, mærket i 96 px over et centreret panel | Login, signup, adgangsport. Ét formål pr. side — et sidehoved ville være støj, for der er intet at navigere væk fra |

Sidehovedet er **navy og ikke charcoal**, fordi site-headeren ovenfor er charcoal; to
charcoal-flader i træk ville smelte sammen.

**Onboarding fik samme sidehoved som resten.** Overvejelsen var at holde quiz-flowet helt rent,
men konsekvens vejede tungere: en ejer der springer mellem dashboard og quiz skal ikke møde to
forskellige verdener.

### Ordlyden på /betaling er rettet

Siden beskrev stadig den **afløste** betalingsmodel — "kortet registreres ved booking,
betalingen trækkes når mødet er afholdt, med varierende betalingsfrekvenser". CLAUDE.md
forbyder udtrykkeligt den ordlyd efter ADR 0034. Teksten beskriver nu et fast abonnement der
forfalder hver fjerde uge, hvor det er **prisen** der varierer med boardstørrelse og frekvens.

⚠ Koden er stadig ikke rettet — det er **B-19**, og den forbliver åben. Ordlyden beskriver
altså den besluttede model, mens implementeringen følger den gamle. Det er forsvarligt fordi
`FLAG_PAYMENTS` er slukket, ingen prisregel findes, og der er ingen Alunta-nøgler: modulet kan
ikke opkræve nogen. Men rækkefølgen skal ikke glemmes — B-19 før betaling går live.

### Formatering

`npx prettier` blev kørt uden at Prettier er en projektafhængighed, og reformaterede med
standard 80 tegn 17 filer der ikke var en del af arbejdet. Det blev rullet tilbage.
Repoets faktiske konvention er **`--print-width 100`**, hvilket er verificeret ved at den er en
no-op på urørte filer. 🟡 Prettier bør enten optages som devDependency med en config, eller
ikke bruges — den nuværende tilstand indbyder til netop den slags utilsigtede diffs.
