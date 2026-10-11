# Fase 6 — Verifikation, dokumentation & overlevering

> Mål: platformen er verificeret ende-til-ende, dokumentationen er komplet, og
> ikke-tekniske ejere kan overtage driften. **Launch: januar 2027** (udskudt fra 1. oktober
> 2026 — Mads, 2026-08-26).
> Forudsætter at fase 5 er grøn. Læs `CLAUDE.md` først.
>
> Bemærk: ADR'er er skrevet løbende siden fase 0 — denne fase *samler og
> verificerer*, den opfinder ikke dokumentationen bagud. Samme gælder
> fase-rapporterne (`docs/fase-0-rapport.md`, `docs/fase-1-rapport.md`, …).

## Leverancekriterier (Definition of Done for fase 6)

- [ ] Ende-til-ende-verifikation af hele rejsen: onboarding → board → booking →
      møde → betaling → honorar.
- [ ] Fuld test suite grøn: unit, integration, DB/RLS, type check. Ingen
      overspringede tests.
- [ ] Sikkerhedsgennemgang: ingen secrets i repo, RLS aktiv på **alle**
      forretningstabeller, webhooks signaturverificerede og idempotente.
- [ ] GDPR-verifikation: EU-residens bekræftet pr. leverandør, DPA'er på plads,
      sletteflow testet ende-til-ende, cookie-samtykkeflow aktivt (optagelse/AI/SMS er kontraktens, ADR 0065).
- [ ] Alle feature-flags gennemgået: hvert flag er enten bevidst tændt til launch
      eller dokumenteret som bevidst slukket.
- [ ] **Stub-registret er tomt eller hver tilbageværende stub er eksplicit accepteret**
      (`docs/stub-register.md`). Ingen stub går i launch uden at nogen har sagt ja.
- [ ] ADR-indekset i `docs/adr/README.md` er komplet og uden huller.
- [ ] Kodegenereret referencedokumentation (typer, API-ruter, schema) genereret.
      *Delvist (2026-10-11):* ruter, skema (inkl. RLS og policies) og miljøvariabler genereres af
      `npm run docs:reference` til `docs/reference/`; **typer** er ikke med. Ikke krydset af, før de er.
- [x] **Overleveringsdokument til Andreas og Mette** — én side, ikke-teknisk
      (`docs/overlevering.md`). Udarbejdet; endnu ikke gennemlæst af Andreas og Mette.
- [x] Runbook: hvad gør man når noget fejler (betaling, video, webhook, hosting)
      (`docs/runbook.md`). Kun det koden understøtter; opdatér den, når en adapter bygges.
- [ ] Ejer-test gennemført og feedback lukket (ejer-test: udgangen af august).
- [ ] Alle resterende uafklarede punkter er enten afklaret eller eksplicit
      parkeret med ejer-accept.

## Arbejdspakker

### 6.1 Ende-til-ende-verifikation
- Kør hele brugerrejsen igennem som ejer, som partner, som lead-partner, som
  admin. Dokumentér resultatet.
- Verificér at Supabase er sandhedskilde: ingen tilstand der kun lever i
  Cal.com eller Alunta.
- Verificér idempotens under gentagne webhooks (bevidst genafspilning).
- Bemærk fra fase 1: kun auth-flowet er hidtil verificeret i **produktion** — resten
  er verificeret lokalt og i CI (`docs/fase-1-rapport.md` §2). Den gæld indfries her.

**Status 2026-10-11 (ADR 0071, `docs/e2e.md`) — delvist udført, intet afkrydset.** Rejserne er
automatiseret med Playwright mod et produktions-build og en lokal Supabase-stak, på demo-adaptere:

- **Grønt (58 tests, ca. 2 min):** ejer (signup → bekræft e-mail → quiz → board → møde → abonnement
  + demo-kort → dashboard), admin (prisregel, honorarregel, skabelon udkast → LIVE, udskift partner,
  invitation, drift, juridisk indsigtsudtræk), partner/lead-partner (login, profil uden tags,
  registrér afholdt + note, honorar, tilgængelighed → booking respekterer den), auth-fri vurdering
  (engangsbrug, forfalsket token), negative adgangstests (UI + RLS mod rigtig PostgREST), webhook-
  signatur og -idempotens (Cal.com, Alunta).
- **Migrationerne 0001-0027 anvendes rent mod rigtig Supabase** (Postgres 17) fra en tom database;
  RLS er slået til på alle 30 tabeller, og hver har mindst én policy.
- **Fund:** B-70 (inviteret partner kan ikke sætte adgangskode — blokerer partner-login i
  produktion), B-71 (ingen bekræftelse efter board-udskiftning i admin). Rettet undervejs: en
  partner kunne registrere et fremtidigt møde som «afholdt» og dermed få honorar for et møde der
  ikke var holdt (`src/server/meetings/registration.ts`).
- **Stadig åbent under 6.1:** «verificér at Supabase er sandhedskilde» for rigtige Cal.com/Alunta-
  hændelser og lead-partnerens fulde rejse mod rigtige leverandører kræver konti — listen står i
  `docs/e2e.md` § «Hvad der IKKE kan verificeres uden leverandørkonti». Rejsen er heller ikke kørt
  mod **produktion** (kun auth-flowet er), og cookie-samtykket har endnu ingen UI at klikke på.

### 6.2 Sikkerhedsgennemgang
- Secrets: intet i repo, alt i Netlify env vars (ADR 0008/0012).
- RLS: hver forretningstabel har policies **og** negative tests (bevis at en
  partner ikke kan læse en andens board, honorar eller noter).
  ⚠ Tjek eksplicit at **hver** tabel har `enable row level security` — i fase 1 blev
  det opdaget at `board_partner` aldrig havde fået den slået til siden migration
  `0002`. Kør en `pg_tables`-mod-`pg_policies`-gennemgang, stol ikke på øjemål.
- Webhooks: signaturverifikation og idempotens på både Cal.com og Alunta.
- Autorisation testet pr. rolle, ikke kun i UI-laget.
- Browser-sikkerhed og tilgængelighed — **status 2026-10-11 (ADR 0070):**
  - [x] Sikkerhedsheadere: HSTS, `nosniff`, `X-Frame-Options`/`frame-ancestors`,
        `Referrer-Policy` (rating-ruten bevarer `no-referrer`), `Permissions-Policy`
        (kamera/mikrofon/lokation slået fra), og **nonce-CSP håndhævet** i proxyen — 0 CSP-
        overtrædelser i Chromium mod `next start`. Nødbremse: `CSP_REPORT_ONLY=true`.
  - [x] Fejlsider: `not-found`, `error` (med «Prøv igen»), `global-error` — ingen stacktraces.
  - [x] Tilgængelighedsgate i CI: axe-core mod de vigtigste komponenter + WCAG-kontrast regnet
        på tokens. Rettet: `<main>` på forside/styleguide, landmark på kontaktbaren, «Spring til
        indhold», global fokusmarkering, slate-tekst under AA.
  - [ ] Åbent: guld-kontrasten (B-80, Mads), Google Fonts (B-81), `img-src https:` (B-82),
        `style-src-attr` (B-83), verifikation på Netlify + checkout-redirect (B-84),
        cookie-banner/PostHog i CSP og manuel skærmlæsertest (B-85).

### 6.3 GDPR-verifikation
- Gennemgå leverandør→region→status-tabellen i `docs/gdpr/leverandoer-register.md`;
  alt skal være grønt eller eksplicit accepteret.
- DPA'er på plads for: Supabase, Netlify, Cal.com, Alunta, Resend, inMobile,
  PostHog og **Ordbogen** (dækker både transskription og LLM — ADR 0024).
- Test sletteflow ende-til-ende på tværs af Supabase og eksterne systemer. *(Flowet er bygget og testet uden
  netværk samt mod Postgres — ADR 0068, `docs/gdpr/sletteflow.md`. Tilbage: kør det mod rigtige PostHog/Resend/
  Cal.com/Supabase Auth, afklar opbevaringspligt og slette-SLA (ejer/jura), og slet manuelt det der ingen API har:
  Cal.com-sæde/attendee-data, inMobile, Ordbogen.)*
- Verificér cookie-samtykket. Samtykke til optagelse, AI og SMS er en del af kontrakten (ADR 0065): verificér at ToS + honoraraftale dækker det og at kontrakten indgås før første møde.
- Bekræft at Netlify Functions-region er sat til EU (Frankfurt, `fra`) — åbent siden fase 0
  (`netlify.toml`).

### 6.4 Flag- og stub-gennemgang
- Gennemgå hvert feature-flag: tændt til launch, eller bevidst slukket?
- Dokumentér de slukkede — især **in-app messaging**, transskription og
  auto-resumé hvis de stadig afventer beslutning, samt `leadPartner`.
- Gennemgå `docs/stub-register.md` post for post: hver tilbageværende stub skal
  enten være løst eller have eksplicit ejer-accept på at gå i launch som stub.
- Bekræft at adgangsporten (ADR 0020) er i den ønskede tilstand ved launch —
  aktiveret under ejer-test, og bevidst tændt eller slukket derefter.
- **`FLAG_DEMO` skal være slået fra** (ADR 0041). Bekræft at ingen adapter rapporterer
  `name = "demo"` mod produktions-env, og at `DemoBadge` ikke vises i headeren.

**Værktøj (ADR 0069, 2026-10-11):** gennemgangen er nu en aflæsning, ikke en opgave med øjemål.
`/admin/klar` viser den kørende konfiguration (pr. port rigtig/demo/stub, `FLAG_DEMO`, krævede
hemmeligheder som sat/mangler, aktive regler, adgangsporten, øvrige flag mod deres dokumenterede
hensigt og de åbne beslutninger), og `npm run launch:check` giver samme tjek fra terminalen plus
TODO-markører, stub-register, backlog og ADR-indeks (exit 1 ved blokering). *Selve gennemgangen er
ikke udført:* hver stub skal stadig accepteres af en ansvarlig (`accepted` i
`src/server/admin/launch-data.json`), og hvert flag dokumenteres som bevidst tændt/slukket.

### 6.5 Dokumentation
- ADR-indeks komplet; ingen beslutning uden ADR.
- Generér kodereference (typer, API-ruter, schema) — **nu** er der overflader at
  generere fra, jf. noten i fase 0.
  *Status 2026-10-11:* `npm run docs:reference` genererer `docs/reference/routes.md`, `schema.md` og
  `env.md` (typer ikke). `-- --check` sammenligner med de committede filer; den er ikke koblet på CI
  (begrundelse i ADR 0069).
- Opdatér `CLAUDE.md` så den beskriver systemet som det faktisk blev. *(Ikke gjort.)*
- Skriv `docs/fase-N-rapport.md` for de faser der mangler en, så den samlede
  beslutnings- og flag-historik står ét sted.

### 6.6 Overlevering til ikke-tekniske ejere
- **Én-sides overleveringsdokument** til Andreas og Mette: hvad platformen gør,
  hvem der har adgang til hvad, hvad der koster penge, hvem man ringer til.
- Runbook: konkrete fejlscenarier og handling — fejlet betaling, video virker
  ikke, webhook-kø hober sig op, hosting nede.
  *Skrevet 2026-10-11:* `docs/overlevering.md` (én side, ikke-teknisk) og `docs/runbook.md`
  (pr. system: symptom → hvor man ser det → hvad man gør → hvem).
- Adgangsoverblik: hvilke konti findes, hvem ejer dem (`docs/accounts-to-create.md`).
- ⚠ Domæne (signupacademy.com) + DNS-adgang til Mads er uafklaret (ejer) — skal
  være løst før launch.

### 6.7 Ejer-test & lukning
- Ejer-test gennemført (mål: udgangen af august) med tid til at rette inden
  1. oktober.
- Feedback trieret: hvad rettes før launch, hvad parkeres bevidst.

## Uafklarede punkter berørt i fase 6 (flag, beslut ikke)

- ToS + honoraraftale (ejer) — **skal foreligge før launch.**
- Domæne signupacademy.com + DNS-adgang til Mads (ejer) — blokerer launch.
- Alle punkter der stadig står åbne fra fase 1-5 skal her enten lukkes eller
  parkeres med eksplicit ejer-accept. Ingen må gå i launch som "uafklaret" uden
  at nogen har sagt ja til det. Kilden er `CLAUDE.md`s liste + fase-rapporterne.

## Bygges IKKE i fase 6

- Nye features. Fase 6 er verifikation og lukning — funktionalitetsfrys.
- WCAG-tilgængelighed er **udgået for nu** (jf. spec V5) — genoptages efter launch.
- Branded videolag (RealtimeKit) og valgbar mødelængde — post-launch, bag flag.
