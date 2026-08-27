# Fase 6 — Verifikation, dokumentation & overlevering

> Mål: platformen er verificeret ende-til-ende, dokumentationen er komplet, og
> ikke-tekniske ejere kan overtage driften. **Launch 1. oktober 2026.**
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
      sletteflow testet ende-til-ende, samtykkeflow aktivt.
- [ ] Alle feature-flags gennemgået: hvert flag er enten bevidst tændt til launch
      eller dokumenteret som bevidst slukket.
- [ ] **Stub-registret er tomt eller hver tilbageværende stub er eksplicit accepteret**
      (`docs/stub-register.md`). Ingen stub går i launch uden at nogen har sagt ja.
- [ ] ADR-indekset i `docs/adr/README.md` er komplet og uden huller.
- [ ] Kodegenereret referencedokumentation (typer, API-ruter, schema) genereret.
- [ ] **Overleveringsdokument til Andreas og Mette** — én side, ikke-teknisk.
- [ ] Runbook: hvad gør man når noget fejler (betaling, video, webhook, hosting).
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

### 6.2 Sikkerhedsgennemgang
- Secrets: intet i repo, alt i Netlify env vars (ADR 0008/0012).
- RLS: hver forretningstabel har policies **og** negative tests (bevis at en
  partner ikke kan læse en andens board, honorar eller noter).
  ⚠ Tjek eksplicit at **hver** tabel har `enable row level security` — i fase 1 blev
  det opdaget at `board_partner` aldrig havde fået den slået til siden migration
  `0002`. Kør en `pg_tables`-mod-`pg_policies`-gennemgang, stol ikke på øjemål.
- Webhooks: signaturverifikation og idempotens på både Cal.com og Alunta.
- Autorisation testet pr. rolle, ikke kun i UI-laget.

### 6.3 GDPR-verifikation
- Gennemgå leverandør→region→status-tabellen i `docs/gdpr/leverandoer-register.md`;
  alt skal være grønt eller eksplicit accepteret.
- DPA'er på plads for: Supabase, Netlify, Cal.com, Alunta, Resend, inMobile,
  PostHog og **Ordbogen** (dækker både transskription og LLM — ADR 0024).
- Test sletteflow ende-til-ende på tværs af Supabase og eksterne systemer.
- Verificér samtykke (inkl. optagelse, hvis aktiveret).
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

### 6.5 Dokumentation
- ADR-indeks komplet; ingen beslutning uden ADR.
- Generér kodereference (typer, API-ruter, schema) — **nu** er der overflader at
  generere fra, jf. noten i fase 0.
- Opdatér `CLAUDE.md` så den beskriver systemet som det faktisk blev.
- Skriv `docs/fase-N-rapport.md` for de faser der mangler en, så den samlede
  beslutnings- og flag-historik står ét sted.

### 6.6 Overlevering til ikke-tekniske ejere
- **Én-sides overleveringsdokument** til Andreas og Mette: hvad platformen gør,
  hvem der har adgang til hvad, hvad der koster penge, hvem man ringer til.
- Runbook: konkrete fejlscenarier og handling — fejlet betaling, video virker
  ikke, webhook-kø hober sig op, hosting nede.
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
