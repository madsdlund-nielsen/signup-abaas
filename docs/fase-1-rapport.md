# Fase 1 — rapport: leverancer + åbne beslutninger

> Status: **fase lukket**. Denne rapport samler hvad Fase 1 leverede, hvad der er
> verificeret, og — vigtigst — de 🔴 punkter fasen efterlader til ejer og Mads. Samme
> formål som `docs/fase-0-rapport.md`: de åbne beslutninger skal ligge **samlet**, ikke
> spredt i kodekommentarer. Definition of Done står afkrydset i `docs/fase-1.md`.

Dato: 2026-08-03. Forfatter: Claude Code. Modtagere: Mads + ejerne (Andreas/Mette).

---

## 1. Hvad Fase 1 leverede (🟢)

Målet var: *en ejer kan gennemføre onboarding-quizzen, få anbefalet et board på 2-3
partnere med profiler, og admin kan styre quiz + partner-katalog + tags.* Det er nået.

| Pakke | Leverance | ADR |
|---|---|---|
| **1.1** Auth-flow | Login/signup/logout via server-actions, `proxy`-session-refresh, `provisionOwner`, side-guards. Hardening: auth-sletning cascader app-data, danske fejlbeskeder, `/check-email`. | 0014, 0015 |
| **1.2** Quiz — admin | CRUD på spørgsmål + options, checkbox-tag-mapping, **preview inden gem**, reorder. Native HTML5-drag — bevidst uden dnd-library. | 0016, 0017 |
| **1.3** Quiz — ejer | Conversational `/onboarding`: ét spørgsmål pr. skærm, progressindikator, firkantede touch-knapper. Første ejer-skrivbare tabel. | 0018 |
| **1.4** Partner-katalog | `/admin/partners` — opret/redigér profiler + autoritativ tag-tildeling. Kataloget er afkoblet fra auth, så admin kan oprette katalogposter uden login-konti. | 0019 |
| **1.5** Board-matching | Grådig set-cover: ejerens quiz-tags × puljen → 2-3 partnere, mindst 1 intern. "Udskift" + infobar med kompetence-delta. | 0021, 0022 |
| **1.6** Board-anbefaling | `/board` med partner-profiler (foto, navn, kompetencer, bio) og lead-markering bag flag. | 0021, 0022 |
| **Ekstra** Adgangsport | Én delt adgangskode **før** auth, så tilfældige besøgende ikke kan nå appen under den lukkede ejer-test. Ikke en planlagt 1.x-pakke. | 0020 |

**Migrationer:** `0004` auth-bruger-cascade · `0005` kompetence-tags + `has_role` ·
`0006` RLS-policies flyttet ind i migrations-strømmen · `0007` quiz · `0008` quiz-svar ·
`0009` partner-katalog · `0010` board-matching.

**ADR'er:** `0014`–`0022` (ni stk.). Indeks i `docs/adr/README.md`.

---

## 2. Verifikation

`lint` · `check` · `build` grønt. Testsuite: **74 unit · 15 integration · 53 db** (142).
CI kører alle fem jobs på hver PR (`.github/workflows/ci.yml`).

Vær opmærksom på hvor grænsen går:

- **Verificeret i produktion:** kun auth-flowet (1.1) — signup → session → ejer-rolle →
  dashboard, bekræftet på Netlify + Supabase eu-north-1.
- **Verificeret lokalt + i CI:** alt øvrigt. Quiz, katalog, matching og board-anbefaling
  er dækket af tests og deploy-previews, men **ikke** gennemspillet ende-til-ende af en
  rigtig bruger i prod. Det bør ske før ejer-testen.
- **Ikke aktiveret:** adgangsporten er bygget, men de tre `APP_GATE_*`-env-vars er ikke
  sat på Netlify. Porten er derfor inaktiv, og appen er offentligt tilgængelig — inklusive
  signup. Skal aktiveres før Andreas og Mette får URL'en.

---

## 3. 🔴 FLAG — uafklarede punkter rørt i Fase 1

Markeret i kode med `// TODO(ejer):` / `// TODO(mads):`.

### Nye punkter rejst i denne fase

| Punkt | Hvor | Hvad der mangler |
|---|---|---|
| **Tie-break ved lige gode kandidater** | `src/server/matching/algorithm.ts:47` | Hvilken partner vinder når flere dækker lige meget? Byggespec §5.2 flager det selv og henviser til "§12, punkt om tie-break" — **men det punkt findes ikke** i §12's tabel (numrene 3, 20 og 23 mangler helt), og det står heller ikke i CLAUDE.md's liste over uafklarede punkter. Det har altså p.t. **ingen ejer**. Rating er fase 4 og tilgængelighed fase 5, så ingen af spec'ens egne forslag kan bruges endnu. Midlertidigt: neutral rækkefølge (`sort_order`, navn, id) — determinisme frem for en opfundet rangering. |
| **Infobar: pris eller kompetence-delta?** | `src/server/matching/algorithm.ts:145` | Byggespec §5.2 kræver at infobaren viser *"løbende pris"* og at (i)-ikonet viser *"præcist prisregnestykke"*. Men startpris/meeting-fee er uafklaret, så prisen kan ikke beregnes. `docs/fase-1.md` omdefinerer infobaren til at forklare hvorfor et match ændrede sig — den fortolkning er bygget. Bekræft den, eller fastlæg prisen. |
| **Kalenderplads-filter ved udskift** | `src/server/matching/index.ts:101` | §5.2 kræver at udskift kun viser *"partnere med kalenderplads"*. Kræver Cal.com multi-host (Fase 2). Hele puljen vises indtil da. |

### Videreført — afventer ejer (forretning)

| Punkt | Hvor |
|---|---|
| Lead-partner: tildelings- og rotationsregler | `src/server/flags/index.ts:38`, `src/server/boards/actions.ts:88,162,195`, `supabase/migrations/0002_board.sql:15`, `0009_partner_profile.sql:14` |
| Board-livscyklus (hvornår slutter et board) | `src/server/boards/index.ts:9`, `supabase/migrations/0002_board.sql:3` |
| Honorarsats pr. partner pr. møde (binder meeting-fee) | `supabase/migrations/0009_partner_profile.sql:23`, `src/lib/payments/port.ts:10` |
| Samtykketekst + ToS + endelig kategori-liste | `src/server/consent/index.ts:6` |
| Partner-/lead-partner-oprettelse: admin frem for self-signup | `src/server/auth/provisioning.ts:8` |
| Dedikeret validerings-/fejlfarve — paletten har **ingen rød** | `src/styles/components.css:185` |
| Regnskabssystem (e-conomic vs. Dinero), in-app messaging, note-synlighed, honorar ved udeblivelse, moms | uændret fra Fase 0 |

### Videreført — afventer Mads (teknisk)

| Punkt | Hvor |
|---|---|
| **Partner-login** — kobl katalogpost ↔ auth-bruger | `supabase/migrations/0010_board_matching.sql:31`, `tests/db/rls.test.ts:32`, `CLAUDE.md:182` |
| Netlify Functions-region = EU (Ireland) — **før rigtige persondata** | `netlify.toml:9` |
| Cal.com multi-host + EU-residens + native optagelse på valgt plan | `src/lib/booking/port.ts:18`, `src/lib/video/port.ts:12` |
| LLM EU-residens/DPA, transskriptionsudbyder, Stripe/Supabase-dataflow | uændret fra Fase 0 |

---

## 4. Fund undervejs (ikke planlagte leverancer)

Tre ting dukkede op som ikke stod i nogen arbejdspakke:

**🔴 `board_partner` havde aldrig RLS slået til.** `0002` aktiverede kun `board`.
Da rollen `authenticated` har fulde table grants, kunne **enhver logget-ind bruger skrive
sig selv ind på et vilkårligt board** — og derved låse `board_select_partner` op på en
fremmed ejers board. Hullet var latent siden Fase 0, fordi ingen fase indtil 1.5 skrev til
tabellen. Lukket i `0010` (RLS on, select-policies for ejer/admin, ingen write-policies) og
dækket af negative tests i `tests/db/board-matching-rls.test.ts`.

**Identitets-afstemningen forfaldt i 1.5.** ADR 0019 valgte bevidst at afkoble kataloget
fra auth for at kunne levere 1.4 uden at beslutte partner-onboarding. Prisen forfaldt straks
efter: matchingen producerer `partner_profile`-id'er, men `board_partner` kunne kun modtage
`app_user`-id'er, og der fandtes ingen kobling. Løst i ADR 0021 ved at flytte FK'en til
kataloget. **Følgevirkning:** partnere kan p.t. ikke se deres eget board (se §5).

**Byggespec'ens §12-henvisning er dangling.** §5.2's tie-break-flag peger på et punkt der
ikke eksisterer. Det er ikke en kodefejl, men det betyder at et reelt åbent spørgsmål aldrig
er landet på nogens bord. Se §3.

---

## 5. Udskudt til Fase 2

- **Partner-login + self-service-profil-redigering** (ADR 0019). Partneren skal kunne
  redigere egen profil-info — men **ikke** egne kompetence-tags, som forbliver admin-styret.
  Kræver auth-bruger-oprettelse/-invitation, partner-ruter og kobling katalogpost ↔ auth-bruger.
- **Partner-synlighed på boardet** (ADR 0021). `board_select_partner` er fjernet, fordi
  `board_partner.partner_id` nu peger på en katalogpost uden auth-konto. Policyen genindføres
  via `partner_profile.app_user_id` sammen med partner-login. Ingen mister noget i mellemtiden:
  der findes hverken partner-login eller partner-UI i dag.

---

## 6. Blokerer produktion — ejer/Mads

Rækkefølgen er ikke tilfældig; de tre første bør ordnes før ejer-testen.

1. **Netlify Functions-region = EU (Ireland)** før der lægges rigtige persondata ind
   (`netlify.toml:9`, kræver ≥ Pro-plan). Sidste EU-residens-punkt for hosting.
2. **Aktivér adgangsporten** — generér hash + cookie-secret, sæt de tre `APP_GATE_*` i
   Netlify env vars (fremgangsmåde i ADR 0020). Uden dem er appen og signup åben for alle.
   *Kendte, bevidst udskudte huller i porten:* ADR 0020 og kodekommentaren i
   `src/server/gate/index.ts` lover begge en advarsel i loggen ved delvis konfiguration —
   den findes ikke i koden; og de tre variabler mangler i `.env.example`. Ingen af delene
   påvirker porten når alle tre vars er sat korrekt.
3. **Resend-SMTP + gen-aktivér e-mailbekræftelse** på Supabase.
4. **DPA-underskrifter** pr. leverandør — `docs/gdpr/leverandoer-register.md` er kilden til
   hvilke der mangler.
5. **Branch protection på `main`** (kræv grøn CI + PR) — kan ikke committes, slås til i
   GitHub-settings. Uændret fra Fase 0.

---

## 7. Næste skridt — Fase 2

Fase 2 (Booking + video) deler sig i to, og kun den ene halvdel kan startes i dag:

- **Blokeret:** Cal.com-booking, webhooks → meetings, Cal Video, mødestatus. Afventer en
  Cal.com-konto og multi-host-spiken (`docs/spikes/multi-host.md` er forberedt, men aldrig
  kørt), plus afklaring af EU-residens og optagelse på valgt plan. Binder pris og
  dataresidens → ejer/Mads-territorium.
- **Ublokeret:** partner-login + self-service-profil (§5). Bruger kun Supabase Auth, som
  allerede kører. Lukker samtidig hullet fra ADR 0021, så partnere igen kan se deres board.

**Der findes endnu ingen `docs/fase-2.md`.** Fase 0 og 1 har begge et detaljeret fasedokument;
Fase 2 eksisterer kun som tre linjer i CLAUDE.md. Det bør skrives før fasen køres.
