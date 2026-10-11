# Ende-til-ende-test — sådan kører man den

> Fase 6.1 (ADR 0071). En rigtig browser (Playwright/Chromium) gennemspiller hele rejsen mod et
> produktions-build af appen, der taler med en **lokal Supabase-stak** i Docker. Kører på
> demo-adaptere (ADR 0041) — ingen leverandørkonti, ingen nøgler, ingen rigtige penge.
>
> Ikke en del af `npm test` og ikke på hver PR (se § CI). Det er gaten for at vi kan sige
> "rejsen virker", ikke for hver commit.

## Forudsætninger

- Docker kørende (`docker info`). Første start henter Supabase-images (nogle GB, minutter).
- Node ≥ 20.12, `npm ci`.
- Chromium til Playwright: `npx playwright install chromium` — eller peg på en eksisterende
  installation med `PLAYWRIGHT_BROWSERS_PATH`. Playwright er pinnet til `1.56.1` (Chromium 141);
  matcher en forhåndsinstalleret browser ikke, kan stien overstyres med `E2E_CHROMIUM_PATH`.
- Ledige porte: `3100` (appen), `54321` (API), `54322` (Postgres), `54324` (Mailpit).

## Kørsel

```bash
npm run e2e:db:up      # starter den lokale Supabase-stak (én gang; bliver stående)
npm run test:e2e       # bygger appen, nulstiller databasen, kører alle specs
npm run e2e:db:down    # stopper stakken når du er færdig
```

`test:e2e` gør selv resten: `next build && next start` på port 3100 med demo-miljøet,
`supabase db reset` (alle migrationer på en tom database), testbrugere og demo-seed.
Et enkelt spec: `npx playwright test 05-adgang`. Se et fejlet spor: `npx playwright show-trace
test-results/<test>/trace.zip`.

Miljøvariabler til kørslen:

| Variabel | Virkning |
|---|---|
| `E2E_SKIP_BUILD=1` | Genbrug det eksisterende `.next` (kun hvis koden ikke er ændret siden sidst). |
| `E2E_NO_RESET=1` | Spring `supabase db reset` over. Kun til at gentage ét spec — `01-ejer` kan ikke signe samme bruger op to gange. |
| `E2E_CHROMIUM_PATH` | Sti til en Chromium-binær hvis `PLAYWRIGHT_BROWSERS_PATH` ikke passer. |
| `E2E_SUPABASE_URL`, `E2E_SUPABASE_PUBLISHABLE_KEY`, `E2E_SUPABASE_SECRET_KEY`, `E2E_SUPABASE_DB_URL`, `E2E_MAIL_URL` | En stak der kører andetsteds. Ellers læses nøglerne fra `supabase status`. |

**Sikkerhedsværn:** opsætningen nulstiller databasen, så den nægter at køre mod alt andet end
loopback. Leverandørvariabler (`CALCOM_API_KEY`, `RESEND_API_KEY` …) og `DATABASE_URL` blankes
eksplicit for app-processen, så en nøgle i din shell eller `.env.local` aldrig kan vinde over
demo-adapteren og ramme en rigtig leverandør.

## Hvad der ligger hvor

```
playwright.config.ts            konfiguration + webServer (build + start)
tests/e2e/supabase/config.toml  den lokale stak (se ADR 0071 for hvorfor den ikke ligger i supabase/)
tests/e2e/supabase/migrations   symlink → ../../../supabase/migrations (samme filer som produktion)
tests/e2e/supabase/templates    kopi af supabase/templates/ (invitations- og nulstillingsmail, ADR 0073) —
                                CLI'en kan ikke følge et symlink ud af projektet; en enhedstest holder dem ens
tests/e2e/global-setup.ts       db reset, testbrugere, demo-seed
tests/e2e/support/              env, brugere + service-role-hjælpere, Mailpit, UI-hjælpere
tests/e2e/0N-*.spec.ts          rejserne (kører i filrækkefølge på én worker)
tests/e2e/__screens__/          skærmbilleder (gitignoreret)
```

Specs deler én database og kører i rækkefølge: `01-ejer` opretter ejerens board, `02-admin`
inviterer partneren, `03-partner` bygger på invitationen (og vælger partnerens adgangskode), `05-adgang` på begge, `06-webhooks`
rører sidst. Kør derfor hele suiten, når du ikke ved hvad et spec forudsætter.

## Hvad rejserne dækker

| Spec | Rejse | Det der verificeres |
|---|---|---|
| `01-ejer` | signup → bekræft e-mail (Mailpit) → login → quiz → board-anbefaling → godkend → book møde → abonnement → demo-kort → dashboard | Hele ejerens vej, inkl. at login afvises før e-mailbekræftelse, og at rollen `ejer` tildeles server-side |
| `02-admin` | prisregel (ny version → aktivér) · honorarregel · skabelon (udkast → publicér → LIVE) · udskift partner på et board (med bekræftelse på siden, B-71) · invitér partner · drift · juridisk indsigtsudtræk (download) | Versionerede regler, to-trins publicering, at sandhedskilden følger boardændringen, at mailen sendes |
| `03-partner` | invitation (Mailpit → `/auth/confirm` → vælg adgangskode → `/partner`) · brugt link fejler roligt → login → profil (men ikke tags) → registrér afholdt + note → lead-dashboard → honorar → tilgængelighed → booking respekterer den | Invitationsflowet hele vejen (B-70, ADR 0073), honorarlinjen, tilgængelighedsvagten på tværs af to browsere |
| `04-vurdering` | `/vurdering/<token>` uden login: åbn (brænder ikke) → indløs → andet forsøg afvises (også fra en fane åbnet før) · forfalsket token · RPC ikke åben | Engangsbrug, HMAC, at `redeem_rating_link` ikke kan kaldes fra den offentlige REST-API |
| `05-adgang` | anonym → login · ejer kan ikke åbne `/admin`/`/partner` · partner kan ikke åbne `/admin`/ejerflader · RLS mod rigtig PostgREST | At forbudte flader er forbudt både i UI og i basen, med et rigtigt `auth.uid()` |
| `06-webhooks` | Cal.com- og Alunta-webhook: forkert signatur (401) · signeret hændelse anvendes · genafspilning giver "allerede behandlet" og ét event | Signatur + idempotens mod den rigtige database |
| `07-glemt-adgangskode` | «Glemt adgangskode?» på login · samme svar for ukendt adresse · `/konto/adgangskode` uden session → login · `/auth/confirm` afviser manglende token, ukendt type og åben redirect · anmod → Mailpit → link → ny adgangskode → den gamle virker ikke, den nye gør | Nulstilling uden konto-orakel, at et engangstoken kun virker én gang, og at ruten aldrig sender brugeren uden for appen |

Skærmbilleder af hver hovedskærm lægges i `tests/e2e/__screens__/{ejer,admin,partner,offentlig}/`
(fuld side, 1280 px). De er **gitignoreret** (de ændrer sig med hvert designtoken og ville støje i
hver PR) og uploades som CI-artefakt `e2e-rapport`.

## Hvad der IKKE kan verificeres uden leverandørkonti

Alt ovenstående kører på demo-adaptere. Disse ting er derfor stadig kun verificeret som kode, ikke
som live-adfærd — de hører til live-verifikationen når nøglerne lander:

| Område | Hvad der mangler | Hvor det spores |
|---|---|---|
| Cal.com | Rigtig multi-host-booking, collective event type, EU-residens på Teams, native optagelse, webhooks fra Cal.com selv (vi signerer dem selv her) | `docs/spikes/multi-host.md` (L-1…L-10) |
| Alunta + QuickPay + Nets | Rigtig checkout, MobilePay, kortgebyrer, 4-ugers kadence (B-35), at en rigtig `invoice.paid`-payload har den form vi parser | `docs/accounts-to-create.md`, B-35 |
| Cal Video | Rigtigt videorum og optagelse | ADR 0046 |
| Ordbogen/OdinCore | Rigtig LLM og transskription; modelnavne mod `GET /v1/models` | `docs/spikes/ordbogen-api.md` |
| Resend | Rigtig afsendelse, EU-region på afsenderdomænet, SPF/DKIM. Supabase Auth's egne mails går via Mailpit lokalt, ikke via produktions-SMTP | `.env.example`, ADR 0057 |
| inMobile | Rigtig SMS | `src/lib/sms/inmobile.ts` |
| PostHog | Rigtig fejl- og driftsmåling | ADR 0066 |
| Netlify | Functions-region (Frankfurt), scheduled functions/cron, SSR-opførsel på Netlify (vi tester `next start`) | `netlify.toml`, fase 0-rapport |
| Supabase (hosted) | Leaked password protection (B-25), e-mailskabeloner (invitation + nulstilling, ADR 0073 — lokalt tvinges de ind via `config.toml`, i produktion sættes de manuelt, `docs/runbook.md`), SMTP og `site_url` i produktion. Lokalt er stakken en CLI-stak, ikke et rigtigt projekt | B-25 |
| Cookie-samtykke | Banneret findes som typet kerne; der er ingen UI at klikke på endnu | `src/server/consent` |
| Planlagte kørsler | `/api/cron/*` med en rigtig scheduler | `netlify/functions/` |

## Fejlfinding

- **"Den lokale Supabase-stak kører ikke"** → `npm run e2e:db:up`.
- **`Data limit exceeded` ved image-pull** → CLI'en prøver selv igen; vent.
- **"Could not find the table … in the schema cache" lige efter reset** → opsætningen venter nu
  på PostgREST; ses det alligevel, så genkør.
- **Port optaget** → noget kører allerede på 3100/54321-54324. `npm run e2e:db:down`, eller find
  processen.
- **Spec fejler på "strict mode violation"** → en tekst findes nu flere steder; skærp selektoren
  med rolle + navn (aldrig CSS).
