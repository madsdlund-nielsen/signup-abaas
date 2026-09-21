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
AI-mødeopfølgning. **Launch: januar 2027** (udskudt fra 1. oktober 2026 — Mads,
2026-08-26). **Næste milepæl: ikke sat.** Den testbare MVP til ejer-test havde frist
mandag 2026-08-31 (`docs/opsaetning-ejer-test.md`); fristen er passeret, og repoet
registrerer ikke om testen blev afholdt eller hvad den gav.
TODO(mads): sæt næste milepæl — og notér udfaldet af ejer-testen, hvis den blev holdt.

Board er kerneproduktet. Alt andet er støttefunktioner.

---

## Teknologistak (låst, medmindre markeret ⚠)

| Lag | Valg | Note |
|---|---|---|
| Frontend/SSR | Next.js | App Router |
| Database/backend | Supabase | **Sandhedskilde for forretningsdata** |
| Booking | **Cal.com Teams-plan** ($12/bruger/md) | ✅ besluttet (ADR 0046) — Platform-planen er lukket for nye kunder. Multi-host = ét collective event type pr. board. Sæder = rådgivere + admin; ejere er attendees. self-host som exit |
| Video | Cal Video (multi-party) | RealtimeKit udgår. Cal.com ansvarlig for optag |
| Betaling ind | **Alunta** | ✅ besluttet (ADR 0023) — erstatter Stripe Billing |
| Betaling ud / bogføring | ⚠ e-conomic ELLER Dinero | ikke afgjort — afventer ejer |
| AI-opfølgning | **Ordbogen (chat.dk / Odin-LLM)** | ✅ besluttet (ADR 0024) — dansk model, dansk datacenter |
| Transskription | **Ordbogen (ordbogen.ai → odincore.ai)** | ✅ besluttet (ADR 0024) — samme danske leverandør og samme konto som LLM |
| E-mail | **Resend (EU, Dublin)** | ✅ besluttet — transaktionsmails |
| SMS | inMobile (dansk) | rating/påmindelser |
| Analytics & fejl | PostHog (EU) | erstatter Sentry |
| Hosting | **Netlify** | ✅ besluttet (ADR 0012, irsk/EU). SSR + cron verificeret i fase 0 |
| Kildekode/CI | GitHub + GitHub Actions + Claude Code | branch protection, tests i CI |

---

## Arkitekturprincipper

1. **Supabase er sandhedskilde** for board-sammensætning, møder, honorar, ratings.
2. **Eksterne systemer afkobles bag webhooks og adaptere** (Cal.com, Alunta,
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

Når en opgave rører et af nedenstående punkter: **byg den simpleste klikbare version
bag et feature-flag, marker med `// TODO(ejer): <punkt>` eller `// TODO(mads): <punkt>`,
og flag det i din opsummering.** Er punktet et *designvalg*, så vis to varianter og lad
ejeren pege — en klikbar version er hurtigere end et spørgsmål (ADR 0042). Opfind aldrig
et svar der binder forretning, pris, jura eller leverandør; det er stadig ikke dit valg.

**Uafklarede punkter blokerer ikke byggeriet — vi bygger med stubs og demo.** Følg
`docs/stub-politik.md` og registrér hver stub i `docs/stub-register.md` i samme
PR. Kernereglen: en stub er et *synligt hul*, ikke et midlertidigt svar. Den
fejler højlydt i produktion frem for at gætte stille. Demo-tilstanden (ADR 0041, se
§ Demo-tilstand) er en dummy der *virker* og er *åbenlyst falsk* — den vælges kun hvor
rigtig config mangler. Skriv aldrig et plausibelt forretningstal som placeholder, og stub
eller demo aldrig autorisation, RLS, webhook-signaturverifikation, idempotens eller
samtykke.

**Afventer ejer (Andreas/Mette) — forretning:**
- Honorarsats pr. partner pr. møde (binder meeting-fee opad)
- Startpris / meeting-fee (ikke fastlagt)
- Ændre/aflyse-vindue inden møde
- Regnskabssystem: e-conomic vs. Dinero
- Honorar ved udeblivelse/sent afbud
- Moms på partner-honorar
- Lead-partner: tildelings- og rotationsregler
- Board-matching: tie-break ved lige gode kandidater (rating? tilgængelighed?).
  Byggespec §5.2 flager punktet og henviser til §12 — men **det punkt findes ikke**
  i §12's tabel (3, 20 og 23 mangler). Fundet i fase 1.5; se `docs/fase-1-rapport.md`
- Note-synlighed (hvem ser møde-noter)
- Board-livscyklus (hvornår slutter et board)
- In-app messaging: **hele modulet uafklaret** — byg ikke uden beslutning
- Noter under møde
- Samtykke til mødeoptagelse
- ToS + honoraraftale
- Domæne (signupacademy.com) + DNS-adgang til Mads

**Afventer Mads — teknisk afklaring (spike/verificér før byg):**
- Cal.com EU-residens **på Teams** — plan-valget (ADR 0046) svarer ikke på det. `apiUrl` er
  udskiftelig (`cal.eu`/self-host). Gate før der lægges produktionsdata ind (spike L-7)
- Cal.com mødeoptagelse — native **på Teams**? (spike L-8)
- Cal.com multi-host-spike: **delvist lukket uden konto** (ADR 0046). L-2 er besvaret —
  `hosts` pr. booking findes ikke i API v2, så multi-host bygges som ét collective event
  type pr. board. **Plan-/tier-STOP'et er hermed også lukket: Teams.** Tilbage står L-1,
  L-3, L-4 og L-5, som kræver en konto. `docs/spikes/multi-host.md`
- ~~Alunta/Supabase dataflow~~ → **afsøgt mod OpenAPI-spec'en (ADR 0032)**: usage-abonnement
  med øre-parameter; adapter + webhooks bygget. Rest: opsætning i Alunta-UI (plan +
  parameter + webhook-secret + faktureringsinterval) og live-verifikation i test_mode

**Lukket siden sidst:**
- ~~Cal.com plan-/tier-valg~~ → **Teams** ($12/bruger/md) (Mads, 2026-09-15; ADR 0046).
  Platform-planen er deprecated og lukket for nye kunder, så managed users + Atoms er ikke
  en åben vej. EU-residens og native optagelse er **ikke** lukket af dette
- ~~Ordbogen DPA/databehandleraftale~~ → **håndteret uden for repoet** (Mads, 2026-09-15;
  ADR 0024-opdatering). Konto er bestilt. Samtykke til optagelse er stadig ejerens punkt
- ~~Hvem indløser?~~ → **Nets** (Mads, 2026-09-15; ADR 0034-opdatering). Betalingskæden er
  **tre parter**: Alunta (abonnement) → QuickPay (gateway) → Nets (indløser). Nets er en
  **selvstændig aftale og konto** — den følger ikke med QuickPay. QuickPay koster 148 kr/md
  + 0,25 kr/transaktion; Nets' kortgebyrer afhænger af indløsningsaftalen og er ikke fastlagt
- ~~Gateway-valg hos Alunta~~ → **QuickPay** (Mads, 2026-08-26; ADR 0034)
- ~~MobilePay gennem Alunta~~ → MobilePay er ikke en Alunta-gateway (ADR 0032), men
  **QuickPay tilbyder MobilePay Online**, så den går via gatewayens checkout (ADR 0034).
  ⚠ Skal stadig verificeres live mod en rigtig QuickPay-konto
- ~~Betalingsmodel: pr. møde vs. abonnement~~ → **fast abonnement hver 4. uge** (ADR 0034)
- ~~Alunta vs. Stripe Billing~~ → **Alunta** (ADR 0023)
- ~~Henosia vs. Netlify~~ → **Netlify** (irsk/EU, ADR 0012)
- ~~LLM EU-dataresidens~~ → **Ordbogen/Odin-LLM, dansk datacenter** (ADR 0024)
- ~~Transskription: dansk/EU-udbyder~~ → **Ordbogen** (ADR 0024). Bemærk: `ordbogen.ai`
  viderestiller nu til **`odincore.ai`** — samme produkt, nyt brand
- ~~SSR + cron-verifikation~~ → verificeret i fase 0
- ~~Auth: Supabase Auth vs. eget system~~ → **Supabase Auth** (ADR 0013)

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

## Betalingsmodel

**Fast abonnement pr. kunde, der forfalder hver 4. uge** (ikke månedligt, ikke årligt).
Abonnementets STØRRELSE afhænger af antal rådgivere på boardet og mødefrekvensen
(4 / 8 / 12 uger). Beslutning: Mads, 2026-08-26 — se **ADR 0034**.

⚠ **Dette erstatter den tidligere model** ("kort registreres ved booking, træk sker ved
afholdelse"), som fase 3 er bygget efter. Koden opkræver i dag pr. afholdt møde og skal
rettes — se `docs/backlog.md` B-19. Brug ikke ordet "varierende betalingsfrekvenser"
om selve opkrævningen længere; frekvensen er fast (4 uger), det er PRISEN der varierer.

---

## Demo-tilstand (ADR 0041)

`FLAG_DEMO=true` giver hver backend-port en **tredje implementering** ved siden af rigtig og
stub: en dummy der *virker*, så rejsen kan klikkes igennem før nøglerne lander. Permanent
produktionskode — bruges også til salgsdemoer og designarbejde efter launch.

- **Sikkerhedsreglen:** demo vælges kun når rigtig config *mangler*. Rigtige nøgler vinder
  altid; demo kan aldrig skygge for en ægte integration.
- **Data-reglen:** alt demo returnerer er åbenlyst falsk — `DEMO-`-referencer, `[DEMO]`-tekster.
  Ingen demo-værdi lever i kode som default. Aldrig plausible tal.
- **Grænser:** demo erstatter leverandørkald, aldrig autorisation, RLS, webhook-signatur,
  idempotens eller samtykke.
- **Synligt:** `DemoBadge` i headeren på hver side. **Slås fra før launch** (`docs/fase-6.md` §6.4).

Ny port → ny `demo.ts` i samme PR, og én linje i factoryen *efter* den rigtige provider.

Befolket tilstand til design og test: `DEMO_OWNER_EMAIL=<signup-mail> npm run db:seed:demo`
(ADR 0043) — kræver en ejer uden board; giver board, demo-kort, et kommende og et afholdt møde.

---

## Byggefaser (opslagsværk) og skiver (arbejdsenhed)

**Siden 2026-09-14 (ADR 0042) arbejder vi i vertikale skiver, ikke i fase-gates.** En skive
er en rejse man kan klikke igennem på sua-abaas.netlify.app — ikke et lag. Det der udestår
bygges **skærm-først**: skærmen med demo-data → Mads klikker og designer → logikken kobles →
den rigtige adapter droppes ind. Skærmen er produktionskode fra første commit; kun
datakilden skifter. Rækkefølgen bestemmer Mads ved at klikke.

**Skærm-først-kandidater (hver sin lille PR):** AI-opsummering på `/moeder/[id]` ·
notifikationsoversigt · partner-honorar · partner-tilgængelighed · rolle-dashboards ·
admin-drift.

Fase-dokumenterne `docs/fase-0.md` … `docs/fase-6.md` og `docs/fase-0-eksekvering.md` er
**opslagsværk** for scope, krav og de uafklarede punkter pr. område — de slettes ikke, og
de gater ikke længere. Status pr. fase:

- **Fase 0 — Fundament (kritisk): ✅ LUKKET.** repo/CI, Next.js+Supabase-skelet, RBAC/RLS,
  feature-flags, env/secrets, PostHog, multi-host-spike, hosting-spike,
  GDPR-arkitektur, auth-valg. Rapport: `docs/fase-0-rapport.md`.
- **Fase 1 — Onboarding & board: ✅ LUKKET 2026-08-03.** auth, quiz (admin-UI + drag-n-drop tags +
  conversational flow + preview), partner-katalog, board-matching (2-3),
  board-anbefaling med profiler, lead-partner flag. Rapport: `docs/fase-1-rapport.md`
  (åbne 🔴 punkter til ejer/Mads står samlet dér).
- **Fase 2 — Booking + video:** Cal.com, webhooks → `meeting`, Cal Video,
  mødestatus + noter, booking/flytning/aflysning i app.
  **+ Partner-login + self-service-profil-redigering** (udskudt fra 1.4, ADR 0019, afsnit 2.8):
  indgang til partner-portalen — auth-bruger-oprettelse/-invitation, partner-ruter, partner
  redigerer egen profil (men IKKE tags), og katalogpost↔auth-bruger kobles. Genopliver
  `board_select_partner` (ADR 0021). `// TODO(mads): partner-login`.
- **Fase 3 — Betaling:** prisberegner, prisregler i admin, Alunta-checkout
  (kortregistrering + MobilePay), webhook → `membership`, varierende
  betalingsfrekvenser, op/nedgradering.
- **Fase 4 — Forberedelse, rating, AI & notifikationer.**
- **Fase 5 — Honorar + tilgængelighed + dashboard.**
- **Fase 6 — Verifikation & dokumentation.**
- **Senere (flag):** branded RealtimeKit-videolag (kun hvis Cal Video underleverer),
  valgbar mødelængde.

---

## Arbejdsform med Claude Code

1. Læs altid CLAUDE.md først; slå op i den relevante `docs/fase-N.md` for scope og krav.
2. Arbejd i skiver: én klikbar rejse eller én skærm ad gangen, hver PR grøn og synlig på
   sua-abaas.netlify.app. Fuld test suite er stadig gaten for hver merge.
3. Når du rører et uafklaret punkt: byg den simpleste klikbare version bag flag, marker,
   flag — og opfind ikke et svar der binder forretning, pris, jura eller leverandør.
4. **ADR-on-ship er obligatorisk, ikke valgfrit.** Hver gang du træffer et
   arkitektur-, stack-, leverandør-, datamodel- eller domænegrænse-valg — eller
   afslutter en spike — skriver du en kort ADR i `docs/adr/` **i den PR der shipper
   skiven, når designet har overlevet klik** (ADR 0042). Følg `docs/adr/README.md`.
   Design kommer efter byg, så dokumentationen af designet kommer også efter — men
   stadig i samme PR, aldrig bagud i fase 6.
5. **Små PR'er, ship ofte (Mads, 2026-09-14 — erstatter merge-økonomien fra
   2026-07-22).** Hver PR er én skive eller én skærm og skal kunne ses på
   sua-abaas.netlify.app. Draft-PR'er er fine til at samle commits; hele faser i én PR
   er det ikke. Netlify-omkostningen måles, ikke antages (ADR 0042).
6. **Teknisk gæld og drift hører i `docs/backlog.md`** — ikke her, og ikke i
   `docs/stub-register.md`. Backloggen er til punkter hvor beslutningen allerede er
   truffet, men koden eller dokumentationen ikke er fulgt med. Luk et punkt ved at
   slette rækken i samme PR som fixet.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
