# Fase 0 — Eksekveringsrækkefølge for Claude Code

> Dette er den konkrete trinsekvens for fase 0. Læs `CLAUDE.md` og `fase-0.md`
> først. Denne fil styrer **rækkefølge og beslutningsgrænser** — ikke hvad de
> enkelte arbejdspakker indeholder (det står i `fase-0.md`).

---

## Beslutningsgrænser — læs dette før du starter

Hvert trin er mærket med én af tre typer. **Typen afgør hvad du må gøre.**

- 🟢 **BYG** — du udfører selv. Tekniske mikrobeslutninger (flag-system,
  test-runner, secrets-struktur, mappestruktur osv.) træffer du selv, men
  **skriv en ADR for hvert ikke-trivielt valg.** Du skal ikke spørge eller
  vente — handl og dokumentér.

- 🟡 **SPIKE** — du undersøger, indsamler data og afleverer en **skriftlig
  anbefaling med begrundelse**. Derefter **STOP ved selve valget.** Du må IKKE
  vælge hosting, auth eller multi-host-tilgang. Mads/ejer træffer valget. Mens
  du venter: **byg videre på det der er eksplicit markeret som uafhængigt** af
  det åbne valg (se "kan fortsætte med"-noten pr. spike). Gå ikke i tomgang, men
  byg heller ikke noget der forudsætter et bestemt udfald af spiken.

- 🔴 **FLAG** — trinnet rører et uafklaret punkt fra `CLAUDE.md`. Markér i kode
  med `// TODO(ejer): …` eller `// TODO(mads): …`, byg bag feature-flag hvis
  muligt, og saml punktet i fase-0-rapporten. Beslut ikke.

**Tommelfingerregel:** Hvis et valg binder forretning, pris, jura, leverandør
eller dataresidens → ikke dit valg. Hvis det er en ren implementeringsdetalje →
dit valg, men dokumentér det som ADR hvis det er ikke-trivielt.

---

## Rækkefølge

### Trin 1 — Repo-skelet og CI-skinner 🟢 BYG
Arbejdspakke 0.1.
1. Initialisér Next.js (App Router) + TypeScript i streng tilstand.
2. Lint, formatering, `tsc --noEmit`.
3. GitHub Actions: lint → type check → (tom) test-kørsel. Grøn fra første commit.
4. Branch protection på `main`: kræv grøn CI + PR.
5. Minimal hello-world-side (skal bruges til deploy i trin 3).

ADR-kandidater: valg af test-runner og test-struktur (skriv ADR).
**DoD:** PR mod main blokeres ved rød CI. Tom test suite grøn.

---

### Trin 1b — Design-token-fundament 🟢 BYG
Tidligt, så alt UI fra fase 1 rammer looket fra start (ikke rettet til bagefter).
1. Læg `docs/design-tokens.css` ind i projektets styling-lag som den eneste
   kilde til farve, font, radius og spacing.
2. Indlæs Open Sans (300/400/600/700).
3. Verificér kanon-CTA: guldfyld, hvid versaltekst, **border-radius: 0**.
4. Ingen komponent må hardcode farve/font/radius — kun token-referencer.

ADR-kandidater: komponentbibliotek-tilgang (egne vs. headless oven på tokens).
**DoD:** En testknap + en overskrift renderer i korrekt navy/guld/Open Sans,
firkantet, udelukkende via tokens.

---

### Trin 2 — Supabase-fundament + migrationsworkflow 🟢 BYG
Del af arbejdspakke 0.2.
6. Opret Supabase-projekt i EU-region.
7. Migrationsworkflow: generate → review SQL → staging → prod. **Ikke** push-mod-prod.
8. Rolle-enum (ejer, partner, lead-partner, admin) + bruger↔rolle-relation.
   Endnu ingen forretningstabeller.

ADR-kandidater: migrationsstrategi/-værktøj (skriv ADR).
**DoD:** Migration kan køres mod staging via review-flow. Roller i schema.

---

### Trin 3 — Hosting-spike 🟡 SPIKE → ADR + STOP
Arbejdspakke 0.6. Rører ⚠ punkt 24 + 26.
9. Deploy hello-world fra GitHub til **både** Henosia og Netlify.
10. Test eksplicit: SSR virker, scheduled job/cron kan køre — på begge.
11. Verificér EU-serverplacering på begge.
12. Skriv anbefaling (data: SSR, cron, EU-residens, DX, pris/begrænsninger).
    **STOP. Mads vælger hosting.**

> Kan fortsætte med imens: intet der hardcoder hosting-specifikke antagelser
> (cron-syntaks, build-output, secrets-mekanik). Trin 4 (auth-vurdering) og
> forberedelse af trin 5 (RLS-design på papir) er uafhængige og må fortsætte.

**Når Mads har valgt:** skriv ADR 0001 (hosting) med valg + begrundelse, og
færdiggør deployment-pipen på den valgte host.

---

### Trin 4 — Auth-spike 🟡 SPIKE → ADR + STOP
Arbejdspakke 0.8. Rører ⚠ punkt 25.
13. Vurdér Supabase Auth vs. eget system mod krav: RLS-samspil, EU-residens,
    senere Stripe/MobilePay-flow.
14. Byg en minimal, isoleret login-prøve på det foretrukne for at bekræfte
    samspil med rolle-relationen fra trin 2 — som *bevis i anbefalingen*, ikke
    som endeligt valg.
15. Skriv anbefaling. **STOP. Mads vælger auth.**

> Kan fortsætte med imens: RLS-policy-design (trin 5) kan forberedes uafhængigt
> af auth-udbyder, da RLS hænger på rolle-relationen, ikke på auth-leverandøren.
> Byg dog ikke den endelige login-integration før valget er truffet.

**Når Mads har valgt:** skriv ADR 0002 (auth), integrér det valgte.

---

### Trin 5 — RBAC/RLS-fundament 🟢 BYG
Resten af arbejdspakke 0.2. Forudsætter auth-valg fra trin 4.
16. Aktivér Row Level Security på alle forretningstabeller fra første tabel.
17. RLS-policies pr. rolle.
18. Policy-tests i DB-testlaget: bevis fx at en partner ikke kan læse en andens
    board. Negative tests er obligatoriske, ikke valgfrie.

ADR-kandidater: RLS-policy-mønster/konvention (skriv ADR).
**DoD:** RLS aktiv, policy-tests grønne i CI.

---

### Trin 6 — Feature-flag-system 🟢 BYG
Arbejdspakke 0.3.
19. Simpelt flag-system (DB- eller env-baseret) der kan skjule hele moduler
    uden ny deployment (fx in-app messaging mørklagt indtil ejerbeslutning).

ADR-kandidater: flag-systemets design (skriv ADR — det er foundational).
**DoD:** Et flag kan slå et modul til/fra uden redeploy.

---

### Trin 7 — Env/secrets-håndtering 🟢 BYG
Afslutning af arbejdspakke 0.1. Forudsætter hosting-valg fra trin 3.
20. Secrets-håndtering for valgt hosting (ingen secrets i repo). Knyt til CI
    og deployment.

ADR-kandidater: secrets-struktur (skriv ADR hvis ikke-trivielt).
**DoD:** Ingen secrets i repo; CI og deploy henter fra secret-store.

---

### Trin 8 — PostHog EU (observability) 🟢 BYG
Arbejdspakke 0.4.
21. Integrér PostHog EU.
22. Verificér basis-events (funnel/device/attribution) **og** at en kastet
    exception faktisk fanges (PostHog erstatter Sentry).

**DoD:** Events og exception-capture verificeret i PostHog EU.

---

### Trin 9 — Multi-host scheduling-spike 🟡 SPIKE → ADR + STOP
Arbejdspakke 0.5. Rører ⚠ punkt 5 + 6.
23. Verificér at Cal.com (Platform managed users + Atoms) kan håndtere et møde
    med flere værter: 2-3 partnere + ejer.
24. ⚠ Punkt 5 (EU-residens) + 6 (optagelse på valgt plan): **verificér og
    dokumentér — beslut ikke.** Hvis blokeret, flag til Mads.
25. Skriv anbefaling/konklusion. **STOP ved valg der binder Cal.com-plan/-tier**
    (pris + dataresidens er ejer-/Mads-territorium).

> Kan fortsætte med imens: intet kerneprodukt afhænger endnu af multi-host —
> trin 10 (GDPR-kortlægning) er uafhængigt og må fortsætte.

**Når afklaret:** skriv ADR 0003 (multi-host) med konklusion + begrænsninger.

---

### Trin 10 — GDPR-arkitektur 🟢 BYG / 🔴 FLAG (blandet)
Arbejdspakke 0.7. Samler trådene fra leverandørvalgene.
26. 🟢 Leverandør→region→status-tabel (EU-residens pr. leverandør).
27. 🔴 DPA-struktur: hvor ligger aftaler, hvilke mangler. Det meste afhænger af
    ToS/ejer → flag, beslut ikke.
28. 🟢 Skitsér sletteflow på tværs af Supabase + eksterne systemer.
29. 🟢 Samtykke-banner som arkitektur-hook (teksten afventer ejer/ToS → 🔴 flag
    selve teksten).
30. Skriv ADR 0004 (GDPR-arkitektur) hvis valgene er ikke-trivielle.

**DoD:** EU-residens kortlagt, sletteflow skitseret, samtykke-hook på plads,
ejer-afhængigheder flagget.

---

## Afslutning af fase 0 — før fase 1

- [ ] Hele DoD-listen i `fase-0.md` er grøn.
- [ ] ADR 0001–0004 findes (hosting, auth, multi-host, GDPR) + ADR'er for de
      ikke-trivielle BYG-valg, alle i indekset i `docs/adr/README.md`.
- [ ] Alle 🔴 FLAG-punkter er samlet i én **fase-0-rapport** til Mads/ejerne, så
      de åbne beslutninger ligger ét sted — ikke spredt i kodekommentarer.
- [ ] Ingen 🟡 SPIKE er afsluttet med et selvvalgt udfald: hver har enten et
      Mads/ejer-bekræftet valg eller står stadig som "afventer".

> Kodegenereret referencedokumentation (TypeDoc/schema-docs) sættes først op
> her til sidst eller i starten af fase 1 — når der findes typer, ruter og
> schema at generere fra. Rejs den ikke tidligere.
