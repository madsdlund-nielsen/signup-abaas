# 0025 — Partner-login: identitetskobling + admin-initieret invitation

- **Status:** Accepteret
- **Dato:** 2026-08-04
- **Fase:** 2
- **Berører uafklaret punkt:** delvist — lukker partner-login (ADR 0019/0021-opfølgning); lead-partner-regler og tags-styring forbliver som besluttet

## Kontekst

ADR 0019 afkoblede bevidst partner-kataloget fra auth (admin opretter katalogposter uden
login-konti), og ADR 0021 flyttede `board_partner.partner_id` til kataloget — med den varslede
pris at `board_select_partner` blev fjernet: partnere kunne ikke se deres eget board, fordi
intet koblede katalogpost og auth-bruger.

Fase 2 gør koblingen nødvendig af to grunde: partneren skal have en portal (se board, redigere
egen profil-info, registrere mødestatus), og booking-porten skal bruge **auth-id'er** som
host-referencer — `board_partner` bærer katalog-id'er, som er et disjunkt id-rum.

Der fandtes intet invitationsflow: `supabase.auth.admin` var ubrugt i hele kodebasen, og
`provisioning.ts` provisionerede kun `ejer` via self-signup.

## Overvejede muligheder

- **A — nullable kobling + admin-invitation:** `partner_profile.app_user_id uuid null unique`;
  admin inviterer pr. e-mail (`auth.admin.inviteUserByEmail`), provisionering kobler.
- **B — partner-self-signup med efterfølgende admin-godkendelse:** åbner en offentlig
  signup-flade for en rolle der er håndplukket; godkendelsesflow skal bygges oveni.
- **C — auth-bruger pr. katalogpost ved oprettelse:** genindfører præcis det ADR 0019 afviste
  (login-konti ingen bruger), og udsteder invitationer før der er noget at logge ind til.

## Beslutning

**A.** I migration `0011_partner_login.sql` + `src/server/`:

- **`partner_profile.app_user_id uuid null unique references app_user(id) on delete set null`.**
  Null = ikke inviteret. `unique` → én katalogpost pr. bruger. `set null` → slettes
  auth-brugeren, består den admin-forfattede katalogpost (ADR 0019's ejerskab).
- **`is_partner_on_board(board_id)` — SECURITY DEFINER-hjælper** (mønster fra `has_role`, 0005).
  To grunde: policies på `board_partner` kan ikke selv læse `board_partner` uden
  `infinite recursion detected in policy`, og byggespec §6 foreskriver eksplicit
  *"Adgang for partnere via SECURITY DEFINER-hjælpefunktioner"*.
- **Genoplivede/nye policies:** `board_select_partner` (tilbage, nu via koblingen),
  `board_partner_select_partner`, `partner_profile_select_self`,
  `partner_profile_select_board_member` (kun eget boards profiler — puljen forbliver skjult,
  GDPR-scoping som 0010), tag-læsning tilsvarende. **Ingen write-policies**: self-service-
  redigering går via service-role bag `requireRole('partner')` + eksplicit ejerskabstjek
  (`app_user_id = auth.uid()`-match i actionen), som alle andre writes.
- **`provisionPartner`** spejler `provisionOwner` (idempotent upsert + verify-readback) og
  **nægter at stjæle** en katalogpost der er koblet til en anden bruger — det ville flytte
  board-adgang.
- **`invitePartner`** (admin-action på katalogposten): `auth.admin.inviteUserByEmail` →
  provisionering med det samme. Invitationen opretter brugeren straks (ubekræftet), så
  rolle og kobling er på plads når partneren sætter sit password via invitationsmailen
  (auth-flow-mønster fra ADR 0014).
- **Tags forbliver admin-styrede ved fravær af policies** — partner-portalen viser dem
  read-only. Uændret fra ADR 0019.

## Konsekvenser

- **Positive:** partnere kan igen se eget board (regressionen fra ADR 0021 lukket); portalen
  (`/partner`) har et RLS-fundament frem for applikationslogik; booking-flowet kan slå
  auth-id'er op gennem koblingen; invitationen er idempotent og kan gentages ufarligt.
- **Negative / pris:** invitationsmailen afhænger af Supabase-SMTP (Resend-opsætning er
  stadig en åben Mads-opgave fra fase 1) — invitationer fejler pænt indtil da.
  En ukoblet partner (inviteret men aldrig accepteret) kan ikke kalender-tjekkes af
  booking-flowet; liveverifikationen afklarer managed-user-provisionering hos Cal.com.
- **Opfølgning:** Cal.com managed users pr. partner (fase 2-liveverifikation);
  partner-tilgængelighed oven på koblingen (fase 5.3).
