# Fase 0 — Fundament (kritisk)

> Mål: et kørende, deploybart skelet med autorisation, observability, GDPR-arkitektur
> og de tekniske spikes der afgør resten af byggeriet. Ingen feature-byg før dette
> er grønt. Læs `CLAUDE.md` først.

## Leverancekriterier (Definition of Done for fase 0)

- [ ] Next.js + Supabase-skelet kører lokalt og deployer fra GitHub.
- [ ] CI grøn: unit + integration + DB-lag + `tsc` type check kører på hver PR.
- [ ] Branch protection på `main`.
- [ ] RBAC/RLS-fundament: roller (ejer, partner, lead-partner, admin) defineret,
      Row Level Security aktiv på alle forretningstabeller.
- [ ] Feature-flag-system på plads (uafklarede moduler kan gemmes bag flag).
- [ ] Env/secrets-håndtering etableret (ingen secrets i repo).
- [ ] PostHog (EU) integreret — basis-events + fejlovervågning verificeret.
- [ ] Multi-host scheduling-spike afsluttet med skriftlig konklusion (ADR).
- [ ] Hosting-spike (Henosia vs. Netlify) afsluttet med valg + ADR.
- [ ] GDPR-arkitektur: EU-residens verificeret pr. leverandør, DPA-struktur,
      skitse for sletteflow + samtykke-banner.
- [ ] Auth-valg truffet (Supabase Auth vs. eget) + ADR.
- [ ] ADR-praksis aktiv fra dag 0: `docs/adr/` etableret, indeks vedligeholdt,
      og spikes 0.5 (multi-host), 0.6 (hosting) og 0.8 (auth) leverer hver en ADR.

## Arbejdspakker

### 0.1 Repo, CI og deployment-skelet
- Next.js (App Router) + TypeScript streng tilstand.
- GitHub Actions: lint, type check, unit, integration, DB-test. Branch protection.
- Minimal "hello world"-deploy fra GitHub for at validere deployment-pipen.

### 0.2 Supabase-fundament + RBAC/RLS
- Supabase-projekt (EU-region).
- Migrationsworkflow (generér/migrér — ikke push-mod-prod).
- Definér rolle-enum og bruger↔rolle-relation.
- **RLS aktiv fra første tabel.** Skriv policy-tests i DB-testlaget.

### 0.3 Feature-flags
- Simpelt flag-system (DB- eller env-baseret). Skal kunne styre synlighed af
  hele moduler (fx in-app messaging) uden ny deployment.

### 0.4 Observability — PostHog (EU)
- Integrér PostHog EU. Verificér funnel/device/attribution-events + at
  fejlovervågning fanger exceptions (erstatter Sentry).

### 0.5 SPIKE — Multi-host scheduling (Cal.com API)
- Verificér at Cal.com kan håndtere møder med flere værter (2-3 partnere +
  ejer) via Platform managed users / Atoms.
- ⚠ Rør punkt 5/6 (EU-residens, optagelse): **verificér, beslut ikke.** Hvis
  blokeret, dokumentér og flag til Mads.
- Output: ADR med konklusion + eventuelle begrænsninger.

### 0.6 SPIKE — Hosting (Henosia vs. Netlify)
- Test SSR + cron/scheduled jobs på begge.
- ⚠ Punkt 24 + 26. Output: valg + ADR. Krav: EU-serverplacering, SSR, cron.

### 0.7 GDPR-arkitektur
- EU-residens-verifikation pr. leverandør (tabel: leverandør → region → status).
- DPA-struktur (hvor ligger aftalerne, hvilke mangler).
- Skitsér sletteflow (hvordan slettes en bruger på tværs af Supabase + eksterne).
- Samtykke-banner som arkitektur-hook (selve teksten afventer ejer/ToS).

### 0.8 Auth-valg
- ⚠ Punkt 25. Beslut Supabase Auth vs. eget system. Krav: spiller sammen med
  RLS, EU-residens, MobilePay/Stripe-flow senere. Output: ADR.

### 0.9 ADR-praksis (løbende autodocs)
- Etablér `docs/adr/` (skabelon + README findes allerede).
- Slå ADR-on-decision til som arbejdsform fra første beslutning — ikke fase 6.
- Hver spike i denne fase (0.5, 0.6, 0.8) afsluttes med en ADR med konklusion,
  begrænsninger og afledte flag. Vedligehold indekset i `docs/adr/README.md`.
- Kodegenereret reference (TypeDoc/schema-docs) sættes IKKE op endnu — der er
  ingen overflader at generere fra. Det hører til slutningen af fase 0 / fase 1
  når der findes typer, API-ruter og schema.

## Uafklarede punkter berørt i fase 0 (flag, beslut ikke)
- Cal.com EU-residens (Mads) · Cal.com optagelse (Mads) · Henosia vs. Netlify
  (Mads) · Auth-valg (Mads) · SSR+cron-verifikation (Mads).
- GDPR: samtykke-tekst og DPA-indhold afhænger af ToS (ejer).
