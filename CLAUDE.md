# CLAUDE.md — ABaaS (Advisory Board as a Service)

Dette er det autoritative styringsdokument for Claude Code i dette repo.
Den fulde byggespec ligger i `docs/byggespec/` (seneste version:
`ABaaS_Byggespec_v5.pdf`) som baggrund — men
**dette dokument styrer adfærd, beslutninger og prioritering.** Ved konflikt
vinder CLAUDE.md, og uafklarede punkter må IKKE besluttes af Claude Code (se
afsnittet "Uafklarede punkter").

---

## Hvad vi bygger

En platform der sammensætter et lille rådgivende advisory board (2-3 partnere)
for en virksomhedsejer, faciliterer betalte møder (60 min + 15 min betalt
forberedelse = 75 min honorar), håndterer booking, video, betaling, honorar og
AI-mødeopfølgning. **Launch: 1. oktober 2026. Ejer-test: udgangen af august.**

Board er kerneproduktet. Alt andet er støttefunktioner.

---

## Teknologistak (låst, medmindre markeret ⚠)

| Lag | Valg | Note |
|---|---|---|
| Frontend/SSR | Next.js | App Router |
| Database/backend | Supabase | **Sandhedskilde for forretningsdata** |
| Booking | Cal.com (Platform managed users + Atoms) | self-host som exit. Multi-host fra launch |
| Video | Cal Video (multi-party) | RealtimeKit udgår. Cal.com ansvarlig for optag |
| Betaling ind | Stripe + MobilePay | ⚠ Alunta undersøges som alternativ |
| Bogføring ud | e-conomic eller Dinero | ⚠ ikke afklaret |
| AI-opfølgning | Anthropic Claude API (eller EU-hostet LLM) | ⚠ EU/DPA verificeres |
| Transskription | ⚠ dansk/EU-udbyder afsøges | til auto-resumé |
| E-mail | Resend (EU, Dublin) | transaktionsmails |
| SMS | inMobile (dansk) | rating/påmindelser |
| Analytics & fejl | PostHog (EU) | erstatter Sentry |
| Hosting | ⚠ Henosia (DK) ELLER Netlify (irsk) | spike i fase 0 |
| Kildekode/CI | GitHub + GitHub Actions + Claude Code | branch protection, tests i CI |

---

## Arkitekturprincipper

1. **Supabase er sandhedskilde** for board-sammensætning, møder, honorar, ratings.
2. **Eksterne systemer afkobles bag webhooks og adaptere** (Cal.com, Stripe,
   video, LLM), så de kan udskiftes uden at røre kernedomænet. Skriv aldrig
   tredjeparts-SDK-kald direkte ind i domænelogik — gå altid gennem en adapter.
3. **GDPR fra fase 0** — EU-residens, DPA-struktur, sletteflow og samtykke-banner
   bygges ind i arkitekturen fra start, ikke tilføjet bagefter.
4. **Feature-flags fra fase 0** — uafklarede/senere moduler bygges bag flags.
5. **RBAC/RLS fra fase 0** — Row Level Security i Supabase er det primære
   autorisationslag, ikke kun applikationslogik.

---

## Roller (domæne)

- **Ejer/kunde** — køber board, booker møder, betaler.
- **Partner** — rådgiver på board. Kan redigere egen profil, **men IKKE egne
  kompetence-tags** (admin styrer tags).
- **Lead-partner** — mindst 1 intern pr. board. Ansvar for næste møde +
  kompetenceoverblik. ⚠ Tildelingsregler uafklaret.
- **Admin** — styrer quiz, tags, priser, notifikationer, board-sammensætning.

---

## Kodestandarder & testpolitik

- TypeScript overalt. Streng `tsc` i CI.
- **Fuld test suite kræves i CI:** unit, integration, DB-lag, og type check.
  Ingen merge til main uden grøn CI.
- Branch protection på `main`. Feature-branches + PR.
- **ADR-dokumentation er løbende og obligatorisk.** Skriv en kort ADR i
  `docs/adr/` hver gang et arkitektur-/stack-/leverandør-/datamodelvalg træffes
  eller en spike afsluttes — i samme PR som beslutningen. Følg
  `docs/adr/README.md`. Dette formaliseres ikke i fase 6; det sker fra fase 0.

---

## Uafklarede punkter — Claude Code MÅ IKKE beslutte disse

Når en opgave rører et af nedenstående punkter: **stop, marker med
`// TODO(ejer): <punkt>` eller `// TODO(mads): <punkt>`, byg bag et feature-flag
hvis muligt, og flag det i din opsummering.** Opfind ikke et svar.

**Afventer ejer (Andreas/Mette) — forretning:**
- Honorarsats pr. partner pr. møde (binder meeting-fee opad)
- Startpris / meeting-fee (ikke fastlagt)
- Ændre/aflyse-vindue inden møde
- Regnskabssystem: e-conomic vs. Dinero
- Honorar ved udeblivelse/sent afbud
- Moms på partner-honorar
- Lead-partner: tildelings- og rotationsregler
- Note-synlighed (hvem ser møde-noter)
- Board-livscyklus (hvornår slutter et board)
- In-app messaging: **hele modulet uafklaret** — byg ikke uden beslutning
- Noter under møde
- Samtykke til mødeoptagelse
- ToS + honoraraftale
- Domæne (signupacademy.com) + DNS-adgang til Mads

**Afventer Mads — teknisk afklaring (spike/verificér før byg):**
- Cal.com EU-residens på valgt niveau
- Cal.com mødeoptagelse — native på valgt plan?
- Transskription: dansk/EU-udbyder
- LLM EU-dataresidens/DPA
- Stripe/Supabase dataflow (kortregistrering, varierende betalingsfrekvenser, webhooks)
- Alunta vs. Stripe Billing
- Henosia vs. Netlify hosting-spike (SSR, cron)
- Auth: Supabase Auth vs. eget system
- SSR + cron-verifikation på valgt hosting

---

## Mikrobeslutninger — klassificeret

Ud over de uafklarede punkter ovenfor opstår der løbende tekniske valg. **Brug
ikke skøn på om noget er "ikke-trivielt" — brug listen.** Tre spande:

**Spand A — kræver ALTID en ADR (du vælger selv, men dokumentér):**
- Mappe-/projektstruktur (feature- vs. lag-baseret)
- Feature-flag-systemets design
- Database-navnekonventioner (case, ental/flertal, FK-navngivning)
- RLS-policy-mønster/-skabelon
- Test-runner og teststruktur
- Migrationsværktøj/-flow
- Secrets-struktur
- Komponentbibliotek-tilgang (egne vs. headless oven på tokens)

**Spand B — fri, ingen ADR, spørg ikke:**
- Filnavne, variabelnavne, intern organisering i en fil
- Dato-/utility-biblioteker
- Import-rækkefølge, kommentarstil, commit-formulering (hold konventionen)

**Spand C — IKKE dit valg (se uafklarede punkter — flag, beslut ikke):**
- Alt der binder forretning, pris, jura, leverandør eller dataresidens.

Når i tvivl om en mikrobeslutning hører i A eller C: **stop og spørg Mads.** Med
god tid til launch foretrækkes et spørgsmål frem for et gæt.

---

## Design (acceptkriterium, ikke kosmetik)

Ejerne dømmer platformen på om den **føles high-end**. UI/UX er derfor et
acceptkriterium på linje med sikkerhed — ikke noget der pyntes til sidst.

- **`docs/design-tokens.css` er autoritativ.** Hardcod aldrig farve, font,
  radius eller spacing i komponenter — referér tokens.
- Udtrykket følger signupacademy.com: navy `#263753`, charcoal `#1A2528`, guld
  `#B4965D` som sparsom accent. Open Sans overalt. **border-radius: 0 overalt.**
- Store overskrifter er tynde (300/400), aldrig fede. Versal-UI med
  letter-spacing. Luftigt, redaktionelt, ingen gradienter.
- Se `docs/designnoter.md` for intention og do/don't.

---

## Betalingsmodel (sprogbrug)

Brug **"varierende betalingsfrekvenser"** konsekvent. Kort registreres ved
booking, træk sker ved afholdelse. Frekvensvalg: 4 / 8 / 12 uger.

---

## Byggefaser (overordnet)

Se `docs/fase-0.md` og `docs/fase-1.md` for detaljer. Resten er overordnede til
planlægning og må ikke startes før fase 0 og 1 er grønne.

- **Fase 0 — Fundament (kritisk):** repo/CI, Next.js+Supabase-skelet, RBAC/RLS,
  feature-flags, env/secrets, PostHog, multi-host-spike, hosting-spike,
  GDPR-arkitektur, auth-valg.
- **Fase 1 — Onboarding & board:** auth, quiz (admin-UI + drag-n-drop tags +
  conversational flow + preview), partner-katalog, board-matching (2-3),
  board-anbefaling med profiler, lead-partner flag.
- **Fase 2 — Booking + video:** Cal.com, webhooks → meetings, Cal Video,
  mødestatus + noter, booking/flytning/aflysning i app.
- **Fase 3 — Betaling:** prisberegner, prisregler i admin, Stripe Checkout +
  MobilePay, webhook → memberships, varierende betalingsfrekvenser, op/nedgradering.
- **Fase 4 — Forberedelse, rating, AI & notifikationer.**
- **Fase 5 — Honorar + tilgængelighed + dashboard.**
- **Fase 6 — Verifikation & dokumentation.**
- **Senere (flag):** branded RealtimeKit-videolag (kun hvis Cal Video underleverer),
  valgbar mødelængde.

---

## Arbejdsform med Claude Code

1. Læs altid CLAUDE.md først, dernæst den relevante `docs/fase-N.md`.
2. Arbejd én fase ad gangen. Afslut ikke en fase uden grøn fuld test suite.
3. Når du rører et uafklaret punkt: marker, flag, fortsæt ikke med et gæt.
4. **ADR-on-decision er obligatorisk, ikke valgfrit.** Hver gang du træffer et
   arkitektur-, stack-, leverandør-, datamodel- eller domænegrænse-valg — eller
   afslutter en spike — skriver du en kort ADR i `docs/adr/` i samme PR som
   beslutningen, før du går videre. Følg `docs/adr/README.md`. En fase er ikke
   færdig hvis dens beslutninger ikke er dokumenteret. Dokumentationen opstår
   synkront med koden, ikke bagud i fase 6.
