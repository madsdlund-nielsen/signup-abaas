# Stub-register

> Alle aktive stubs og beslutnings-pladsholdere. Reglerne står i
> `docs/stub-politik.md`. **Registrér i samme PR som stubben opstår.**
> Fase 6 (§6.4) gennemgår registret: hver post skal være løst eller have eksplicit
> ejer-accept før launch.
>
> Sidst gennemgået: 2026-08-03 (oprettet).

## Backend-stubs — kaster `NotConfiguredError`

Aktiv når `isEnabled(<flag>) && isConfigured(config)` ikke er opfyldt. Kan ikke
udføre ægte kald, og lader være med at foregive andet.

| Modul | Flag | Låses op af | Skylder svar |
|---|---|---|---|
| `src/lib/booking/` (Cal.com) | `FLAG_BOOKING` | Cal.com-konto + multi-host-spike (`docs/spikes/multi-host.md`, aldrig kørt) + EU-residens på valgt niveau | Mads |
| `src/lib/video/` (Cal Video) | `FLAG_VIDEO` | Cal.com-plan + EU-residens; mødeoptagelse kræver desuden samtykkeflow | Mads + ejer |
| `src/lib/payments/` (Alunta) | `FLAG_PAYMENTS` | Alunta-nøgler, Alunta/Supabase-dataflow, MobilePay-verifikation (ADR 0023) | Mads |
| `src/lib/accounting/` | `FLAG_ACCOUNTING` | Leverandørvalg: e-conomic vs. Dinero | Ejer |
| `src/lib/llm/` (Ordbogen Odin) | `FLAG_AIFOLLOWUP` | Ordbogen-DPA (ADR 0024) | Mads |
| `src/lib/transcription/` (ordbogen.ai) | `FLAG_TRANSCRIPTION` | Ordbogen-DPA **og** samtykke til optagelse (ADR 0024) | Mads + ejer |

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

## Bevidst tomme — ikke stubs

Til afgrænsning, så gennemgangen i fase 6 ikke leder efter dem:

- **Adgangsporten** (ADR 0020) er fuldt implementeret, blot ikke aktiveret — de tre
  `APP_GATE_*`-env-vars er ikke sat. Det er en driftstilstand, ikke en stub.
- **Honorarberegning, prisregler og dashboards** findes ikke endnu. Manglende kode er
  ikke en stub; de hører til fase 3 og 5.
