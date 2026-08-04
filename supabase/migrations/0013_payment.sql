-- Fase 3 — betalings-datamodel. Byggespec §4/§5.9/§6, ADR 0028 (datamodel + versionering +
-- charge-ved-afholdelse) + ADR 0029 (Alunta-tilgang). Naming: ADR 0006 (ental, snake_case).
-- RLS: ADR 0007 (policies i migrationen, <tabel>_<operation>_<rolle>, idempotent).
--
-- Betalingsmodellen (§4): kort registreres ved booking, træk sker PR. AFHOLDT MØDE — intet
-- månedligt abonnement. Deraf: ingen proratering (ingen forudbetaling findes), og op-/nedgradering
-- er rene Supabase-operationer der slår igennem ved næste afholdelse.
--
-- INGEN TAL: prisregler seedes aldrig og har ingen defaults — værdier indtastes af admin i prod
-- (stub-politik: aldrig et plausibelt forretningstal i kode/seed). Uden en aktiv prisregel fejler
-- prisberegning højlydt.

create type membership_status as enum ('aktiv', 'opsagt');
create type membership_card_status as enum ('mangler', 'registreret');
create type payment_charge_status as enum ('afventer', 'gennemfoert', 'fejlet');

-- Kundens aftale (byggespec §6 memberships): én pr. board. Frekvensen kommer fra ejerens
-- quiz-svar (quiz_option.frequency_weeks) ved oprettelse og kan ændres her (op/nedgradering).
create table membership (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null unique references board(id) on delete cascade,
  frequency_weeks int not null check (frequency_weeks in (4, 8, 12)),
  status membership_status not null default 'aktiv',
  provider text not null default 'alunta',
  provider_customer_ref text,                          -- null indtil kort er registreret
  card_status membership_card_status not null default 'mangler',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prisregler som APPEND-ONLY versioner (nyt mønster i repoet — ADR 0028). Formlen (mekanik,
-- ikke tal): meeting_fee = round((base + antal_partnere × per_partner) × faktor_for_frekvens).
-- TODO(ejer): startpris/meeting-fee + frekvensfaktorer (§12 pkt. 2) — admin indtaster værdierne.
-- TODO(ejer): moms — beløb er rå øre uden momslogik (§12 pkt. 14).
create table pricing_rule (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  base_amount_minor int not null check (base_amount_minor >= 0),
  per_partner_amount_minor int not null check (per_partner_amount_minor >= 0),
  factor_4_weeks numeric(6,4) not null check (factor_4_weeks > 0),
  factor_8_weeks numeric(6,4) not null check (factor_8_weeks > 0),
  factor_12_weeks numeric(6,4) not null check (factor_12_weeks > 0),
  currency text not null default 'DKK',
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Højst ÉN aktiv version ad gangen — constrainten ER mekanismen (som webhook-idempotens).
create unique index pricing_rule_one_active on pricing_rule (is_active) where is_active;

-- Opkrævningsgrundlag pr. afholdt møde. Spec-hul lukket her (ADR 0028): §6 har ingen
-- charge-entitet, men §3 kræver at kunden "ser fakturaer", og fejlede træk skal kunne
-- håndteres/gentages. meeting_id UNIQUE = idempotens-lag 2 (lag 1 er afholdelses-flippets
-- én-vejs-guard). pricing_rule_id er audit: hvilken version blev anvendt.
-- TODO(ejer): fejlet træk vs. honorar/adgang — kun status + årsag registreres, ingen konsekvens.
create table payment_charge (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null unique references meeting(id) on delete cascade,
  membership_id uuid not null references membership(id) on delete cascade,
  pricing_rule_id uuid not null references pricing_rule(id),
  amount_minor int not null check (amount_minor >= 0),
  currency text not null,
  status payment_charge_status not null default 'afventer',
  failure_reason text,
  provider_charge_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payment_charge_membership_idx on payment_charge (membership_id);

-- Webhook-idempotens + audit for betalingshændelser (ADR 0027-mønstret, spejler
-- meeting_webhook_event). Payload-/signaturskema hos Alunta er uafsøgt — TODO(mads):
-- dataflow-afsøgning (§12 pkt. 10) verificerer formen; mekanikken her er leverandørneutral.
create table payment_webhook_event (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'alunta',
  provider_event_id text not null,
  event_type text not null,
  provider_charge_ref text,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

-- --- RLS ---
alter table membership enable row level security;
alter table pricing_rule enable row level security;
alter table payment_charge enable row level security;
alter table payment_webhook_event enable row level security;

-- membership: ejeren ser sin egen aftale (via board), admin ser alt.
-- INGEN partner-policies — betalingsdata er aldrig partner-synlig.
drop policy if exists membership_select_owner on membership;
create policy membership_select_owner on membership
  for select using (
    exists (select 1 from board b where b.id = membership.board_id and b.owner_id = auth.uid())
  );

drop policy if exists membership_select_admin on membership;
create policy membership_select_admin on membership
  for select using (has_role('admin'));

-- pricing_rule: den AKTIVE version er læsbar for alle authed (client-side live prisberegner,
-- §5.9); alle versioner kun for admin.
drop policy if exists pricing_rule_select_active_authenticated on pricing_rule;
create policy pricing_rule_select_active_authenticated on pricing_rule
  for select using (auth.uid() is not null and is_active);

drop policy if exists pricing_rule_select_admin on pricing_rule;
create policy pricing_rule_select_admin on pricing_rule
  for select using (has_role('admin'));

-- payment_charge: ejeren ser egne opkrævninger (via membership→board), admin ser alt.
drop policy if exists payment_charge_select_owner on payment_charge;
create policy payment_charge_select_owner on payment_charge
  for select using (
    exists (
      select 1
      from membership m
      join board b on b.id = m.board_id
      where m.id = payment_charge.membership_id and b.owner_id = auth.uid()
    )
  );

drop policy if exists payment_charge_select_admin on payment_charge;
create policy payment_charge_select_admin on payment_charge
  for select using (has_role('admin'));

-- payment_webhook_event: driftsdata — kun admin læser.
drop policy if exists payment_webhook_event_select_admin on payment_webhook_event;
create policy payment_webhook_event_select_admin on payment_webhook_event
  for select using (has_role('admin'));

-- Ingen write-policies på nogen af tabellerne: writes via service-role bag rolle- +
-- ejerskabstjek i src/server (mønster fra 0009/0010/0012).
