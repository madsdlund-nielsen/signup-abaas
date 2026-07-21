# 0014 — Auth-flow-mønster (login/signup/guard)

- **Status:** Accepteret
- **Dato:** 2026-07-21
- **Fase:** 1
- **Berører uafklaret punkt:** nej (bygger på ADR 0013 auth-valg).

## Kontekst

Fase 1.1 kræver et fungerende login/signup-flow oven på Supabase Auth (ADR 0013), plus et
genbrugeligt mønster for hvordan beskyttede sider/actions håndhæver auth. Vi vil undgå at hver
feature genopfinder session-håndtering, og holde service-role-hemmeligheden væk fra klienten.

## Overvejede muligheder

- **Server-actions + proxy-refresh (valgt)** — formularer kalder server-actions; en `proxy`
  (Next 16-konvention, afløser `middleware`) refresher session-cookies pr. request; sider
  guardes server-side.
- **Klient-side Supabase-auth (browser-SDK)** — mere klientkode, tokens i klienten, sværere at
  holde service-role væk; unødvendigt til e-mail/password.

## Beslutning

Mønsteret for al app-lags-auth:

1. **Server-actions** (`src/server/auth/actions.ts`, `"use server"`): `signInAction`,
   `signUpAction`, `signOutAction`. Formularen bruger React 19 `useActionState`; fejl vises som
   en pæn notits, succes `redirect()`er. Ukonfigureret Supabase → venlig besked, ikke crash.
2. **Session-refresh i `src/proxy.ts`** — kanonisk `@supabase/ssr`-mønster; kun URL + anon-nøgle
   (ingen service-role på edge). No-op når ukonfigureret.
3. **Rolle-provisionering server-side** (`provisionOwner`, service-role): self-signup opretter
   `app_user` + tildeler `ejer` — brugere kan ikke selv-tildele roller (RLS, ADR 0013). Partnere
   oprettes af admin (fase 1.4).
4. **Side-guard**: server-komponenter kalder `getCurrentUser()`; `null` → `redirect("/login")`.
   Rolle-krav håndhæves med `requireRole()` (+ RLS i databasen som andet lag).
5. **UI kun via tokens**: `Field`/`AuthForm` + `.field`/`.form`/`.auth-card` i `components.css`
   — ingen inline-styles eller hardcodede farver (ADR 0002 / design-krav).

## Konsekvenser

- Positive: ét mønster for beskyttede ruter; service-role forbliver server-only; siderne virker
  kontofrit (stub) så CI er grøn uden Supabase-projekt.
- Negative / pris: fuld ende-til-ende-verifikation (rigtigt login) kræver et live Supabase-projekt
  (eu-north-1) — endnu ikke oprettet; indtil da testes logikken med injiceret klient + siderne
  rendrer stub-stien.
- Opfølgning:
  - 🔴 TODO(mads): opret Supabase-projekt + udfyld `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY`
    → verificér login/signup/logout ende-til-ende.
  - TODO(mads): e-mail-bekræftelses-flow afhænger af Supabase-projektets indstilling.
  - Login/signup-**UI** er bevidst minimal; fuld onboarding-oplevelse er resten af fase 1.
