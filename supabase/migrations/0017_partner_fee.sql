-- Fase 5.1/5.2 — partner-honorar. Byggespec §5.6/§5.10/§6, ADR 0051 (versioneret honorarregel +
-- partner-synlig honorarlinje). Naming: ADR 0006 (ental, snake_case). RLS: ADR 0007
-- (policies i migrationen, <tabel>_<operation>_<rolle>, idempotent).
--
-- Honoraret afledes af felter der allerede findes: meeting.duration_minutes + prep_minutes
-- (75 min, 0012) og meeting_partner.registered_status (partnerens egen registrering, ADR 0026).
-- Denne migration tilføjer KUN det der manglede: en versioneret honorarregel og en view der
-- gør "en partner ser kun eget honorar" til en egenskab ved selve læsevejen.
--
-- INGEN TAL: honorarreglen seedes aldrig og har ingen defaults for sats (stub-politik: aldrig
-- et plausibelt forretningstal i kode/seed). Uden en regel der gælder for et mødetidspunkt er
-- linjen 'ingen sats' — det vises, der gættes ikke.

-- Moms på partner-honorar er ikke afgjort. 'ikke_fastlagt' er DEFAULT og betyder: beløbet vises
-- uden momsbehandling. De to andre værdier registrerer kun hvad admin har besluttet — der
-- beregnes aldrig en momssats i kode.
-- TODO(ejer): moms på partner-honorar (§12 pkt. 14).
create type fee_vat_mode as enum ('ikke_fastlagt', 'ekskl_moms', 'inkl_moms');

-- Honorar ved forsinket afbud/udeblivelse er ikke afgjort. 'ikke_fastlagt' er DEFAULT: grundlaget
-- registreres (meeting_partner.registered_status), men konsekvensen beregnes ikke.
-- TODO(ejer): honorar ved udeblivelse/sent afbud (§12 pkt. 13).
create type fee_absence_rule as enum ('ikke_fastlagt', 'intet_honorar', 'fuldt_honorar');

-- Honorarregler som APPEND-ONLY versioner (ADR 0051). Til forskel fra pricing_rule (én aktiv
-- version, 0013) har en honorarregel et GYLDIGHEDSTIDSPUNKT: et møde afregnes efter den regel
-- med senest effective_from <= meeting.starts_at. Dermed ændrer en historisk opgørelse sig
-- aldrig retroaktivt, uden at nogen skal "aktivere" noget — og to versioner kan ikke begge være
-- gældende for samme mødetidspunkt (effective_from er unik og vælges deterministisk).
-- TODO(ejer): honorarsats pr. partner pr. møde (§12 pkt. 1) — admin indtaster satsen.
create table fee_rule (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  hourly_rate_minor int not null check (hourly_rate_minor >= 0),   -- øre pr. time; grundlaget er 75 min
  currency text not null default 'DKK',
  vat_mode fee_vat_mode not null default 'ikke_fastlagt',
  absence_rule fee_absence_rule not null default 'ikke_fastlagt',
  effective_from timestamptz not null unique,
  created_at timestamptz not null default now()
);

-- Én honorarlinje pr. (møde, deltagende partner) — INGEN beløb, kun grundlaget. Beløbet
-- beregnes i src/server/fees/algorithm.ts mod den regel der gælder for starts_at, så en
-- ændret regel aldrig kræver at gemte beløb rettes.
--
-- Hvorfor en view med eksplicit filter og ikke blot RLS på meeting_partner: meeting_partner's
-- policy lader en partner se ALLE deltagere på mødets board (så portalen kan vise medpartnere,
-- 0012). Honorar er den ene ting en partner ikke må se for andre. `security_invoker = true`
-- betyder at viewen læser med kalderens rettigheder, så underliggende RLS (ejer/partner/admin)
-- stadig gælder; WHERE-filteret indsnævrer så til egne rækker (eller alle for admin).
-- Ejere falder uden for filteret: de ser aldrig honorar, selv om de må se deltagerlisten.
create view partner_fee_line
  with (security_invoker = true)
as
select
  mp.meeting_id,
  mp.partner_profile_id,
  pp.app_user_id,
  pp.name as partner_name,
  m.starts_at,
  m.status as meeting_status,
  m.duration_minutes,
  m.prep_minutes,
  mp.registered_status,
  mp.registered_at
from meeting_partner mp
join meeting m on m.id = mp.meeting_id
join partner_profile pp on pp.id = mp.partner_profile_id
where pp.app_user_id = auth.uid() or has_role('admin');

-- --- RLS ---
alter table fee_rule enable row level security;

-- fee_rule: admin ser alle versioner; partnere ser dem også (de skal kunne se hvilken sats og
-- hvilket gyldighedstidspunkt deres opgørelse bygger på). Ejere og anonyme ser intet.
drop policy if exists fee_rule_select_admin on fee_rule;
create policy fee_rule_select_admin on fee_rule
  for select using (has_role('admin'));

drop policy if exists fee_rule_select_partner on fee_rule;
create policy fee_rule_select_partner on fee_rule
  for select using (has_role('partner') or has_role('lead_partner'));

-- Ingen write-policies: writes via service-role bag requireRole('admin') i src/server/fees/actions
-- (mønster fra 0009/0010/0012/0013).

-- Viewen er for indloggede brugere; anon har ingen grund til at kunne nå den (underliggende RLS
-- ville give 0 rækker, men et endpoint der ikke skal bruges, skal ikke være eksponeret — ADR 0047).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on partner_fee_line from anon;
  end if;
end $$;
