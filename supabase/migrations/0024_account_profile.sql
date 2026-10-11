-- Skive K — kontoprofil: navn, telefon, tidszone og SMS-samtykke på brugeren (ADR 0061).
-- Naming: ADR 0006 (ental, snake_case). RLS: ADR 0007 (policies i migrationen,
-- <tabel>_<operation>_<rolle>, idempotent).
--
-- Hvorfor kolonner på app_user og ikke en 1:1-tabel: app_user har allerede den rigtige
-- adgangsmodel (kun brugeren selv — `app_user_select_self`, 0006 — og INGEN write-policies, så
-- alle writes går via service-role bag et ejerskabstjek). En ekstra tabel ville kræve en
-- række pr. bruger (backfill + provisionering) og to policy-sæt, uden at give andet end en
-- adskillelse vi ikke har brug for endnu. Prisen — at en fremtidig bredere læse-policy på
-- app_user ville blotlægge telefonnummeret — er beskrevet i ADR 0061 sammen med modgrebet.
--
-- Hvad kolonnerne løser (lukker tre huller fra tidligere skiver):
--   display_name   attendee-navn hos Cal.com (før: e-mailadressen) og kontoens navn i
--                  skabelonvariablen {{modtager_navn}}
--   time_zone      attendee-tidszone hos Cal.com (før: fast Europe/Copenhagen)
--   phone_e164 +   telefonnummer til transaktions-SMS (notifikationsmotoren, ADR 0057) —
--   sms_opt_in     og KUN når brugeren selv har givet det til det formål
--
-- Ingen kolonne har en forretningsværdi som default: navn og telefon er null, samtykket er
-- false. Tidszonens default er kontoens oprindelige antagelse (alle ejere er danske) — en
-- teknisk standard, ikke et forretningstal.

alter table app_user
  add column if not exists display_name text,
  add column if not exists phone_e164 text,
  add column if not exists time_zone text not null default 'Europe/Copenhagen',
  add column if not exists sms_opt_in boolean not null default false,
  add column if not exists sms_opt_in_at timestamptz;

-- Navn: ikke tomt, ikke mere end 100 tegn, ingen styretegn (linjeskift ville kunne snige sig ind
-- i en e-mailemnelinje eller et Cal.com-felt). Appen trimmer og samler mellemrum før skrivning.
alter table app_user drop constraint if exists app_user_display_name_valid;
alter table app_user add constraint app_user_display_name_valid check (
  display_name is null
  or (char_length(btrim(display_name)) between 1 and 100 and display_name !~ '[[:cntrl:]]')
);

-- Telefon: E.164 — '+', landekode (1-9), i alt 7-15 cifre. Formatet er internationalt og
-- uafhængigt af landet; "+45 foran 8 cifre"-hjælpen er appens (normalisér i ./validation).
alter table app_user drop constraint if exists app_user_phone_e164_format;
alter table app_user add constraint app_user_phone_e164_format check (
  phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
);

-- Tidszone: IANA-FORM (Område/Sted, fx Europe/Copenhagen, America/Argentina/Buenos_Aires) eller
-- UTC. Formen vogter databasen; at navnet findes i tz-databasen vogter appen (Intl), fordi en
-- liste i en constraint ville kræve en migration for hver ny zone. Se ADR 0061.
alter table app_user drop constraint if exists app_user_time_zone_format;
alter table app_user add constraint app_user_time_zone_format check (
  time_zone = 'UTC' or time_zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2}$'
);

-- SMS-samtykke: tilstanden er enten "givet" (afkrydset, med tidspunkt og et nummer det gælder)
-- eller "ikke givet" (uden tidspunkt). Et samtykke uden nummer eller uden tidspunkt er en
-- ødelagt tilstand — og et tilbagekaldt samtykke efterlader ikke et tidspunkt der ligner et gyldigt.
alter table app_user drop constraint if exists app_user_sms_opt_in_consistent;
alter table app_user add constraint app_user_sms_opt_in_consistent check (
  (sms_opt_in and sms_opt_in_at is not null and phone_e164 is not null)
  or (not sms_opt_in and sms_opt_in_at is null)
);

-- --- RLS ---------------------------------------------------------------------------------
-- RLS er slået til på app_user (0003); `app_user_select_self` (0006) lader brugeren læse sin
-- egen række — og dermed de nye felter. Der er bevidst INGEN write-policy: brugeren redigerer
-- sin profil via en server-action (service-role bag getCurrentUser), så en direkte
-- PostgREST-skrivning heller ikke kan ændre e-mail eller id.

-- Admin læser (indsigtsudtræk, support). Ingen skrivning.
drop policy if exists app_user_select_admin on app_user;
create policy app_user_select_admin on app_user
  for select using (has_role('admin'));
