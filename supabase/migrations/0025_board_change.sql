-- Skive L — admin styrer board-sammensætning: revisionsspor (ADR 0062). Naming: ADR 0006 (ental,
-- snake_case, FK <tabel>_id). RLS: ADR 0007 (policies i migrationen, <tabel>_<operation>_<rolle>,
-- idempotent).
--
-- Hvorfor en tabel og ikke en analytics-hændelse: en ændring af hvem der sidder på et board
-- ændrer hvad ejeren betaler (prisen følger boardstørrelsen), hvem der ser ejerens behov (leadet)
-- og hvem der bookes mod (Cal.com-værterne). Det er forretningsdata, og Supabase er sandhedskilden
-- (arkitekturprincip 1) — PostHog er samtykkestyret og kan ikke være revisionsspor. Tabellen bærer
-- også resultatet af Cal.com-synkroniseringen, så admin kan se at et boards værter hænger efter
-- sammensætningen (`calcom_sync`), uden at skulle gætte.
--
-- INGEN persondata ud over pseudonyme id'er: hvem (app_user), hvad og hvornår — ingen navne,
-- e-mails eller fritekst. Sletter en bruger eller en katalogpost sig, nulstilles referencen
-- (on delete set null) og rækken består som anonym historik; slettes boardet, følger rækkerne med.

create table board_change (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references board(id) on delete cascade,
  actor_id uuid references app_user(id) on delete set null,
  -- Hvilken rolle handlede: ejeren på sit eget board, eller admin. (Ikke user_role-enum'en: kun
  -- disse to kan ændre et board, og en tekst-check kræver ingen enum-migration hvis det udvides.)
  actor_role text not null check (actor_role in ('ejer', 'admin')),
  action text not null check (action in ('tilfoej', 'fjern', 'udskift', 'saet_lead', 'opdater_hosts')),
  -- tilfoej/fjern/saet_lead: den berørte partner. udskift: den indkommende.
  partner_id uuid references partner_profile(id) on delete set null,
  -- Kun udskift: den udgående partner.
  replaced_partner_id uuid references partner_profile(id) on delete set null,
  -- Hvad skete der med boardets collective event type hos Cal.com som følge af handlingen?
  --   opdateret     hosts blev skrevet til Cal.com
  --   fejlet        hosts skulle skrives, men Cal.com (eller et manglende sæde) afviste det → boardet
  --                 hænger efter, indtil admin kører "Opdatér hosts"
  --   sprunget_over der var intet at opdatere (ikke koblet endnu, demo-tilstand, eller en lead-
  --                 markering, som ikke ændrer værterne)
  calcom_sync text not null check (calcom_sync in ('opdateret', 'fejlet', 'sprunget_over')),
  created_at timestamptz not null default now()
);

create index board_change_board_idx on board_change (board_id, created_at desc);

alter table board_change enable row level security;

-- Kun admin læser. Ejeren ser ikke sporet (det indeholder admins handlinger og id'er), og ingen
-- har write-policies: rækker skrives af service-role bag requireRole(...) i
-- src/server/boards/audit.ts.
drop policy if exists board_change_select_admin on board_change;
create policy board_change_select_admin on board_change
  for select using (has_role('admin'));
