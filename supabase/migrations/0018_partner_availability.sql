-- Fase 5.3 — partner-tilgængelighed. Naming: ADR 0006 (ental, snake_case, FK <tabel>_id).
-- RLS: ADR 0007 (policies i migrationen, <tabel>_<operation>_<rolle>, idempotent).
-- Datamodelvalg: ADR 0052.
--
-- Supabase er sandhedskilde for tilgængelighed (arkitekturprincip 1). Synk til Cal.com-
-- schedules er et senere skridt (TODO(mads), docs/stub-register.md) og kræver at booking-
-- adapteren er omskrevet til collective event types (B-23, ADR 0046).
--
-- Tidszone: ALLE klokkeslæt og datoer i de to tabeller er LOKAL VÆGURSTID i Europe/Copenhagen
-- — ikke UTC, ikke tidszone-annoterede. En vindue 09:00-12:00 betyder "09-12 dansk tid" hele
-- året, også efter sommertidsskift. Konverteringen til absolutte tidspunkter sker i
-- src/server/availability/algorithm.ts, så DST-reglerne bor ét sted og er enhedstestet.
-- (Derfor `time` og `date`, ikke `timestamptz`: et tilbagevendende ugevindue er ikke et
-- tidspunkt, og en `timestamptz` ville flytte sig en time to gange om året.)

-- --- Ugentlige faste vinduer ------------------------------------------------------------
--
-- "Ikke angivet" er ikke en række: en partner uden rækker her har ikke begrænset sin
-- tilgængelighed, og booking behandler det som INGEN BEGRÆNSNING. Det er en beslutnings-
-- pladsholder, ikke en forretningsregel — TODO(ejer): skal "ikke angivet" i stedet betyde
-- "ikke bookbar"? Registreret i docs/stub-register.md. Reglen bor i algorithm.ts, ikke her.
create table partner_availability (
  id uuid primary key default gen_random_uuid(),
  partner_profile_id uuid not null references partner_profile(id) on delete cascade,
  -- ISO-ugedag: 1 = mandag … 7 = søndag.
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  -- 24:00 er gyldig i Postgres' `time` og betyder "til midnat".
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint partner_availability_end_after_start check (end_time > start_time),
  -- Samme vindue to gange er altid en fejl; PARTIELT overlappende vinduer tillades og
  -- slås sammen af algoritmen (en exclusion constraint ville kræve btree_gist for en
  -- gevinst, brugeren ikke mærker).
  constraint partner_availability_unique_window
    unique (partner_profile_id, weekday, start_time, end_time)
);

create index partner_availability_partner_idx on partner_availability (partner_profile_id);

-- --- Fraværsperioder --------------------------------------------------------------------
--
-- Hele dage, begge ender inklusive. Fravær gælder UANSET om partneren har angivet ugevinduer
-- (en eksplicit "jeg er væk" er information, ikke fravær af information).
--
-- `note` er partnerens EGEN huskeseddel. Den kan i praksis komme til at indeholde en årsag
-- (sygdom = helbredsoplysning, GDPR art. 9), så den er bevidst PRIVAT: se RLS nedenfor, og
-- UI'et beder partneren lade være med at skrive årsager. Ejeren ser aldrig noten.
create table partner_absence (
  id uuid primary key default gen_random_uuid(),
  partner_profile_id uuid not null references partner_profile(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint partner_absence_end_not_before_start check (ends_on >= starts_on)
);

create index partner_absence_partner_idx on partner_absence (partner_profile_id);

-- --- RLS --------------------------------------------------------------------------------

alter table partner_availability enable row level security;
alter table partner_absence enable row level security;

-- Egne rækker: partneren (via koblingen partner_profile.app_user_id, 0011) og admin.
drop policy if exists partner_availability_select_self on partner_availability;
create policy partner_availability_select_self on partner_availability
  for select using (
    exists (
      select 1 from partner_profile pp
      where pp.id = partner_availability.partner_profile_id and pp.app_user_id = auth.uid()
    )
  );

drop policy if exists partner_availability_select_admin on partner_availability;
create policy partner_availability_select_admin on partner_availability
  for select using (has_role('admin'));

drop policy if exists partner_absence_select_self on partner_absence;
create policy partner_absence_select_self on partner_absence
  for select using (
    exists (
      select 1 from partner_profile pp
      where pp.id = partner_absence.partner_profile_id and pp.app_user_id = auth.uid()
    )
  );

drop policy if exists partner_absence_select_admin on partner_absence;
create policy partner_absence_select_admin on partner_absence
  for select using (has_role('admin'));

-- BEVIDST UDELADT: ingen select-policy for boardets ejer — hverken på ugevinduer eller
-- fravær (ADR 0052). Ejeren har brug for at se *hvornår boardet er ledigt*, ikke råtabellerne,
-- og fraværsrækken bærer en privat note. Booking-visningen beregnes server-side
-- (service-role bag ejerskabstjek af boardet, src/server/availability) og afleverer kun de
-- fælles ledige vinduer — aldrig rækker, aldrig noter. Hvis ejeren senere skal læse
-- ugevinduerne direkte, er det én policy her (join board_partner → board.owner_id).
--
-- Heller ikke boardets øvrige partnere ser hinandens tilgængelighed.
--
-- Ingen write-policies på nogen af tabellerne: alle writes går via service-role bag
-- "er det min partnerprofil"-tjek i src/server/availability/actions.ts (mønster fra
-- src/server/partners/self-actions.ts).
