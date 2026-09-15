# Stub-register

> Alle aktive stubs og beslutnings-pladsholdere. Reglerne står i
> `docs/stub-politik.md`. **Registrér i samme PR som stubben opstår.**
> Fase 6 (§6.4) gennemgår registret: hver post skal være løst eller have eksplicit
> ejer-accept før launch.
>
> Sidst gennemgået: 2026-09-15 (Cal.com-plan + felt-kontrakt, ADR 0046; Ordbogen-DPA lukket).

## Backend-stubs — kaster `NotConfiguredError`

Aktiv når `isEnabled(<flag>) && isConfigured(config)` ikke er opfyldt. Kan ikke
udføre ægte kald, og lader være med at foregive andet.

| Modul | Flag | Låses op af | Skylder svar |
|---|---|---|---|
| `src/lib/booking/` (Cal.com) | `FLAG_BOOKING` | **Adapteren er bygget, men mod en forkert felt-kontrakt** — `hosts` pr. booking findes ikke i API v2 (ADR 0046). Låses op af: **(a)** rework til collective event type pr. board (`docs/backlog.md` B-23), **(b)** Cal.com **Teams**-konto + `CALCOM_API_KEY`/`CALCOM_WEBHOOK_SECRET`, **(c)** liveverifikation L-1/L-3…L-9. ~~plan-/tier-STOP~~ → lukket: Teams | Mads |
| `src/lib/video/` (Cal Video) | `FLAG_VIDEO` | ~~Cal.com-plan~~ (lukket: Teams, ADR 0046) + EU-residens (spike L-7); mødeoptagelse kræver desuden native støtte på Teams (L-8) **og** samtykkeflow | Mads + ejer |
| `src/lib/payments/` (Alunta) | `FLAG_PAYMENTS` | **Adapteren ER skrevet mod verificeret API** (ADR 0032, `alunta.ts`), men mod den **afløste usage-model** — ADR 0034 kræver fast abonnement pr. 4 uger (`docs/backlog.md` B-19). Låses op af: rework B-19 → Alunta-UI-opsætning (**abonnement med 4-ugers interval** + webhook-secret) → `ALUNTA_API_KEY`/`ALUNTA_PLAN_ID`/`ALUNTA_WEBHOOK_SECRET` + `FLAG_PAYMENTS` → live-verifikation i test_mode. ~~Gateway-valget~~ → lukket: **QuickPay**, som også er indløser (ADR 0034) | Mads |
| `src/lib/accounting/` | `FLAG_ACCOUNTING` | Leverandørvalg: e-conomic vs. Dinero | Ejer |
| `src/lib/llm/` (Ordbogen Odin) | `FLAG_AIFOLLOWUP` | ~~Ordbogen-DPA~~ → håndteret uden for repoet. **Konto bestilt** (2026-09-15); mangler kun `LLM_API_KEY` + flag | Mads |
| `src/lib/transcription/` (ordbogen.ai) | `FLAG_TRANSCRIPTION` | ~~Ordbogen-DPA~~ → håndteret uden for repoet. Konto bestilt; mangler `TRANSCRIPTION_API_KEY` + flag. 🔴 **Samtykke til optagelse (ejer) består** — må aldrig stubbes | Mads + ejer |

## Demo-implementeringer (ADR 0041) — ikke huller

Aktive når `FLAG_DEMO` er sat **og** modulets rigtige config mangler. Rigtige nøgler vinder
altid. Alt de returnerer er åbenlyst falsk. **`FLAG_DEMO` skal være slået fra ved launch**
(fase 6 §6.4).

| Modul | `demo.ts` | Hvad demoen gør |
|---|---|---|
| `src/lib/booking/` | ✅ | Bekræfter tidspunktet uændret; "Deltag" → `/moeder/rum/[uid]`. Tjekker ingen kalendere |
| `src/lib/video/` | ✅ | Møderum → `/moeder/rum/[meetingId]` |
| `src/lib/payments/` | ✅ | Kortregistrering → `/betaling/demo-kort/[membershipId]` (bekræftes af `confirmDemoCard`); forbrug kvitteres med `DEMO-CHARGE-…` |
| `src/lib/accounting/` | ✅ | Kvitterer med `DEMO-INVOICE-…` |
| `src/lib/llm/` | ✅ | Fast `[DEMO]`-opsummering med tre handlingspunkter |
| `src/lib/transcription/` | ✅ | Fast `[DEMO]`-transskript, `da-DK` |
| `email`, `sms`, `analytics` | — | Fire-and-forget-stubs logger og resolver allerede |

## Fire-and-forget-stubs — logger og resolver

Manglende kald ændrer ikke forretningstilstand, så stubben logger hvad den ville
have gjort.

| Modul | Flag | Låses op af | Skylder svar |
|---|---|---|---|
| `src/lib/email/` (Resend) | `FLAG_EMAIL` | Konto + nøgle + DPA. Bruges også til Supabase-SMTP (fase 1-opfølgning) | Mads |
| `src/lib/sms/` (inMobile) | `FLAG_SMS` | Konto + nøgle + DPA | Mads |
| `src/lib/analytics/` (PostHog EU) | `FLAG_ANALYTICS` | Live projektnøgle | Mads |

## Auth

| Sted | Hvad | Låses op af | Skylder svar |
|---|---|---|---|
| `StubSessionProvider` (`src/server/auth/index.ts`) | Returnerer `null` som nuværende bruger når Supabase Auth ikke er konfigureret — holder kontofri CI/dev kørende | Ikke et åbent punkt: aktiv Supabase-konfiguration slår den fra automatisk (ADR 0013) | — |

## Beslutnings-pladsholdere

Huller der ikke kan fejle højlydt, fordi funktionen skal returnere noget. Neutrale og
deterministiske frem for plausible — se `docs/stub-politik.md`.

| Sted | Pladsholder | Rigtig regel afventer | Skylder svar |
|---|---|---|---|
| `src/server/matching/algorithm.ts:47` | Tie-break sorterer på `sort_order`, navn, id | Byggespec §5.2 flager punktet og henviser til §12 — **det punkt findes ikke** i §12's tabel (3, 20 og 23 mangler). Punktet har derfor ingen ejer endnu | Ejer |
| `src/server/matching/algorithm.ts:145` | Infobaren viser **kompetence-delta**, ikke pris | §5.2 kræver "løbende pris" + "præcist prisregnestykke"; startpris/meeting-fee er ikke fastlagt. `docs/fase-1.md` er styrende indtil da | Ejer |
| `src/server/boards/actions.ts:88,162,195` | Lead-partner sættes på den første interne partner | Tildelings- og rotationsregler (byggespec §12 pkt. 15). Manuel markering ligger bag flaget `leadPartner` (OFF) | Ejer |
| `src/server/matching/index.ts:101` | Udskift viser hele puljen | §5.2 kræver "kun partnere med kalenderplads" — forudsætter Cal.com multi-host (fase 2) | Mads |
| `src/server/flags/index.ts:53` | `inAppMessaging` er hårdkodet `false` uanset env | Hele modulet er uafklaret — scope og om det overhovedet skal med | Ejer |
| `src/server/meetings/actions.ts` (reschedule/cancel) | **Intet ændre-/aflyse-vindue håndhæves** — ejeren kan flytte/aflyse frit | Byggespec §12 pkt. 4: hvor langt inden mødet må der ændres/aflyses? Reglen tilføjes som konfiguration | Ejer |
| `src/server/meetings/actions.ts` (registerMeetingStatus) | `forsinket_afbud`/`udeblivelse` registreres uden konsekvens | Honorar ved udeblivelse/sent afbud (§12 pkt. 13) — fase 5 beregner når reglen findes | Ejer |
| `supabase/migrations/0012_meeting.sql` (meeting_note-RLS) | Note-synlighed: restriktiv default (forfatter + board-ejer) | Hvem må se møde-noter (§12 pkt. 16)? Udvidelse er én policy | Ejer |
| `src/app/moeder/[id]/page.tsx` (AI-opsummering) | Opsummeringen vises **kun for ejeren** — restriktiv default håndhævet i siden, da der endnu ikke findes en tabel at lægge RLS på (skærm-først, fase 4.4) | Note-synlighed (§12 pkt. 16) gælder også resuméer. Når resuméet får en tabel, flytter reglen til RLS | Ejer |
| `pricing_rule` (0013) | **Ingen aktiv prisregel findes** — beregning og charge-grundlag er slået fra indtil admin aktiverer en version. Demo-seed'et (ADR 0043) kan indsætte en åbenlyst falsk 1-kr-regel sammen med en demo-ejer, kun hvor ingen aktiv findes — demodata, ikke en pladsholder i kode | Startpris/meeting-fee + frekvensfaktorer (§12 pkt. 2). Tal indtastes af admin, aldrig af kode | Ejer |
| `src/server/pricing/algorithm.ts` | Beløb er rå øre uden momslogik | Moms på partner-honorar/beløbsvisning (§12 pkt. 14) | Ejer |
| `src/server/charges/` | Fejlet træk registreres (status + årsag) uden konsekvens for honorar eller adgang | §5.10 udløser honorar uafhængigt af betaling; koblingen er uafklaret (afledt af §12 pkt. 13) | Ejer |
| ~~`src/server/charges/webhook.ts`~~ | ~~Provisorisk payload-form~~ → **verificeret mod spec'en (ADR 0032)**: `Signature`-header, WebhookPayload-form, afledt event-id | Lukket 2026-08-04 | — |

## Bevidst tomme — ikke stubs

Til afgrænsning, så gennemgangen i fase 6 ikke leder efter dem:

- **Adgangsporten** (ADR 0020) er fuldt implementeret, blot ikke aktiveret — de tre
  `APP_GATE_*`-env-vars er ikke sat. Det er en driftstilstand, ikke en stub.
- **Honorarberegning, prisregler og dashboards** findes ikke endnu. Manglende kode er
  ikke en stub; de hører til fase 3 og 5.
