-- ---------------------------------------------------------------------------------------
-- DEMODATA til ejer-test — IKKE en migration, IKKE produktionsdata.
--
-- Formål: at ejerne åbner appen og møder en udfyldt quiz og et partnerkatalog i stedet for
-- tomme skærme. Migrationerne opretter kun de otte kanoniske kompetence-tags (0005);
-- quiz og katalog er tomme fra start, og admin ville ellers skulle taste alt manuelt.
--
-- KØRSEL:  npm run db:seed:demo      (kræver DATABASE_URL)
-- FJERN:   npm run db:seed:demo:clean
--
-- Idempotent: alle rækker har FASTE uuid'er i d0000000-…-serien, så gentagne kørsler ikke
-- duplikerer, og oprydning er en enkelt sletning på id-præfiks.
--
-- ⚠ HVAD DER BEVIDST IKKE SEEDES:
--   * `pricing_rule` — priser er ejer-territorium (§12 pkt. 2). `docs/stub-politik.md`
--     forbyder et plausibelt forretningstal i koden, også som demodata. Admin taster den
--     første prisregel i /admin/priser.
--   * `partner_profile.app_user_id` — demopartnere har intet login. Rigtige partnere
--     inviteres af admin (ADR 0025).
--   * auth-brugere og roller — de kan ikke oprettes i SQL. Se docs/opsaetning-ejer-test.md.
-- ---------------------------------------------------------------------------------------

begin;

-- --- Quiz: ét kompetence-spørgsmål (multi) + ét frekvens-spørgsmål (single) ---------------

insert into quiz_question (id, key, prompt, kind, sort_order, is_published) values
  ('d0000000-0000-4000-8000-000000000101', 'udfordringer',
   'Hvor har din virksomhed mest brug for sparring lige nu?', 'multi', 1, true),
  ('d0000000-0000-4000-8000-000000000102', 'frekvens',
   'Hvor ofte vil du mødes med dit advisory board?', 'single', 2, true)
on conflict (id) do nothing;

-- Kompetence-options: én pr. kanonisk tag (0005) + en fritekst til "noget andet".
insert into quiz_option (id, quiz_question_id, label, kind, frequency_weeks, sort_order) values
  ('d0000000-0000-4000-8000-000000000201', 'd0000000-0000-4000-8000-000000000101', 'Vi mister kunder — fastholdelse og churn',        'tag',       null, 1),
  ('d0000000-0000-4000-8000-000000000202', 'd0000000-0000-4000-8000-000000000101', 'Vi er i tvivl om vores priser og pakker',          'tag',       null, 2),
  ('d0000000-0000-4000-8000-000000000203', 'd0000000-0000-4000-8000-000000000101', 'Vi skal sælge mere — salg og marketing',           'tag',       null, 3),
  ('d0000000-0000-4000-8000-000000000204', 'd0000000-0000-4000-8000-000000000101', 'Vi mangler overblik over økonomi og nøgletal',     'tag',       null, 4),
  ('d0000000-0000-4000-8000-000000000205', 'd0000000-0000-4000-8000-000000000101', 'Vi står utydeligt — positionering og kommunikation','tag',      null, 5),
  ('d0000000-0000-4000-8000-000000000206', 'd0000000-0000-4000-8000-000000000101', 'Vi skal skalere, rejse kapital eller sælge',       'tag',       null, 6),
  ('d0000000-0000-4000-8000-000000000207', 'd0000000-0000-4000-8000-000000000101', 'Vi skal have mere ud af tech, automatisering og AI','tag',      null, 7),
  ('d0000000-0000-4000-8000-000000000208', 'd0000000-0000-4000-8000-000000000101', 'Vi vil ud på nye markeder',                        'tag',       null, 8),
  ('d0000000-0000-4000-8000-000000000209', 'd0000000-0000-4000-8000-000000000101', 'Noget andet — skriv gerne kort',                   'free_text', null, 9),
  ('d0000000-0000-4000-8000-000000000221', 'd0000000-0000-4000-8000-000000000102', 'Hver 4. uge',                                      'frequency',    4, 1),
  ('d0000000-0000-4000-8000-000000000222', 'd0000000-0000-4000-8000-000000000102', 'Hver 8. uge',                                      'frequency',    8, 2),
  ('d0000000-0000-4000-8000-000000000223', 'd0000000-0000-4000-8000-000000000102', 'Hver 12. uge',                                     'frequency',   12, 3)
on conflict (id) do nothing;

-- Kobling option → kompetence-tag. Dette er hvad board-matchingen (ADR 0022) konsumerer.
insert into quiz_option_competence_tag (quiz_option_id, competence_tag_id)
select o.id, t.id
from (values
  ('d0000000-0000-4000-8000-000000000201'::uuid, 'fastholdelse-og-churn'),
  ('d0000000-0000-4000-8000-000000000202'::uuid, 'prissaetning-og-pakker'),
  ('d0000000-0000-4000-8000-000000000203'::uuid, 'salg-og-marketing'),
  ('d0000000-0000-4000-8000-000000000204'::uuid, 'oekonomi-og-noegletal'),
  ('d0000000-0000-4000-8000-000000000205'::uuid, 'positionering-og-kommunikation'),
  ('d0000000-0000-4000-8000-000000000206'::uuid, 'skalering-funding-og-exit'),
  ('d0000000-0000-4000-8000-000000000207'::uuid, 'tech-automatisering-og-ai'),
  ('d0000000-0000-4000-8000-000000000208'::uuid, 'udland-nye-markeder')
) as m(option_id, tag_slug)
join quiz_option o on o.id = m.option_id
join competence_tag t on t.slug = m.tag_slug
on conflict do nothing;

-- --- Partnerkatalog: seks demoprofiler ---------------------------------------------------
-- Navnene er opdigtede. `long_bio` starter med "Demoprofil", så ingen forveksler dem med
-- rigtige rådgivere. Dækningen er valgt så matchingen har noget reelt at arbejde med:
-- hvert tag er dækket mindst én gang, og der er overlap, så tie-break faktisk udløses.

insert into partner_profile (id, name, title, is_internal, languages, short_bio, long_bio, sort_order) values
  ('d0000000-0000-4000-8000-000000000301', 'Astrid Nørgaard', 'Kommerciel direktør', true,  'Dansk, engelsk',
   'Har skaleret to SaaS-forretninger fra 5 til 50 medarbejdere.',
   'Demoprofil (testdata). Arbejder med kommerciel struktur: prissætning, pakketering og den svære overgang fra grundlægger-salg til et rigtigt salgsteam.', 1),
  ('d0000000-0000-4000-8000-000000000302', 'Mikkel Bang Sørensen', 'CFO og bestyrelsesrådgiver', true, 'Dansk, engelsk',
   'Tidligere CFO i to vækstvirksomheder, nu fast bestyrelsesmedlem.',
   'Demoprofil (testdata). Fokus på nøgletal ejeren faktisk kan styre efter, likviditet i vækst, og hvad en investor kigger efter længe før en runde.', 2),
  ('d0000000-0000-4000-8000-000000000303', 'Leila Haddad', 'Marketingstrateg', true, 'Dansk, engelsk, fransk',
   'Bygger positionering for B2B-virksomheder der lyder som alle andre.',
   'Demoprofil (testdata). Arbejder med positionering og budskaber — hvorfor kunder vælger jer frem for den næste på listen, og hvordan det bliver hørbart.', 3),
  ('d0000000-0000-4000-8000-000000000304', 'Jonas Vestergaard', 'Tech- og AI-rådgiver', true, 'Dansk, engelsk',
   'Automatiserer drift i virksomheder uden egen udviklingsafdeling.',
   'Demoprofil (testdata). Ser på hvor teknologi reelt flytter marginalen — og hvor den mest bliver et projekt der aldrig bliver færdigt.', 4),
  ('d0000000-0000-4000-8000-000000000305', 'Camilla Riis', 'Kundechef og churn-specialist', false, 'Dansk, engelsk',
   'Har halveret churn i to abonnementsforretninger.',
   'Demoprofil (testdata). Arbejder med fastholdelse som en systematisk disciplin frem for en kampagne: onboarding, tidlige varselstegn og gensalg.', 5),
  ('d0000000-0000-4000-8000-000000000306', 'Peter Lundgaard', 'Eksportrådgiver', false, 'Dansk, engelsk, tysk',
   'Har åbnet DACH-markedet for fire danske virksomheder.',
   'Demoprofil (testdata). Fokus på hvornår et nyt marked er en mulighed og hvornår det er en distraktion — og hvad det faktisk koster at finde ud af.', 6)
on conflict (id) do nothing;

insert into partner_profile_competence_tag (partner_profile_id, competence_tag_id)
select p.id, t.id
from (values
  ('d0000000-0000-4000-8000-000000000301'::uuid, 'prissaetning-og-pakker'),
  ('d0000000-0000-4000-8000-000000000301'::uuid, 'salg-og-marketing'),
  ('d0000000-0000-4000-8000-000000000301'::uuid, 'skalering-funding-og-exit'),
  ('d0000000-0000-4000-8000-000000000302'::uuid, 'oekonomi-og-noegletal'),
  ('d0000000-0000-4000-8000-000000000302'::uuid, 'skalering-funding-og-exit'),
  ('d0000000-0000-4000-8000-000000000303'::uuid, 'positionering-og-kommunikation'),
  ('d0000000-0000-4000-8000-000000000303'::uuid, 'salg-og-marketing'),
  ('d0000000-0000-4000-8000-000000000304'::uuid, 'tech-automatisering-og-ai'),
  ('d0000000-0000-4000-8000-000000000304'::uuid, 'oekonomi-og-noegletal'),
  ('d0000000-0000-4000-8000-000000000305'::uuid, 'fastholdelse-og-churn'),
  ('d0000000-0000-4000-8000-000000000305'::uuid, 'prissaetning-og-pakker'),
  ('d0000000-0000-4000-8000-000000000306'::uuid, 'udland-nye-markeder'),
  ('d0000000-0000-4000-8000-000000000306'::uuid, 'positionering-og-kommunikation')
) as m(partner_id, tag_slug)
join partner_profile p on p.id = m.partner_id
join competence_tag t on t.slug = m.tag_slug
on conflict do nothing;

-- --- Befolket tilstand for en EKSISTERENDE ejer (ADR 0043) ------------------------------
-- Seed'et kan ikke oprette auth-brugere, så board, medlemskab og møder hægtes på en ejer der
-- allerede har oprettet sig via /signup. Scriptet sætter `demo.owner_email` på sessionen
-- (DEMO_OWNER_EMAIL=… npm run db:seed:demo); uden den springes hele blokken over, og seed'et
-- gør præcis som før (quiz + katalog).
--
-- Formål: før/efter-skærme kan klikkes og designes uden at gennemspille rejsen hver gang:
-- board (tre partnere), medlemskab med demo-kort, et kommende møde med dagsorden, et afholdt
-- møde med opkrævning, note og vurderinger. Alle id'er ligger i d0000000-…-serien.
--
-- ⚠ Prisregel: én DEMO-regel (1,00 kr + 1,00 kr pr. partner, faktor 1,0 → 4,00 kr for tre
--   partnere) indsættes KUN hvis ingen aktiv regel findes. Tallet er åbenlyst falsk (ADR 0041's
--   data-regel) og fjernes af demo-clean. Findes en rigtig regel, røres intet, og ingen
--   opkrævning seedes — tal er stadig ejer-territorium.

do $$
declare
  v_email        text := nullif(current_setting('demo.owner_email', true), '');
  v_owner        uuid;
  v_board        constant uuid := 'd0000000-0000-4000-8000-000000000401';
  v_membership   constant uuid := 'd0000000-0000-4000-8000-000000000501';
  v_rule         constant uuid := 'd0000000-0000-4000-8000-000000000601';
  v_meeting_next constant uuid := 'd0000000-0000-4000-8000-000000000701';
  v_meeting_held constant uuid := 'd0000000-0000-4000-8000-000000000702';
  v_astrid       constant uuid := 'd0000000-0000-4000-8000-000000000301';
  v_mikkel       constant uuid := 'd0000000-0000-4000-8000-000000000302';
  v_camilla      constant uuid := 'd0000000-0000-4000-8000-000000000305';
  v_next_start   timestamptz := date_trunc('day', now()) + interval '9 days' + interval '10 hours';
  v_held_start   timestamptz := date_trunc('day', now()) - interval '19 days' + interval '10 hours';
begin
  if v_email is null then
    raise notice '[seed] demo.owner_email er ikke sat — springer den befolkede tilstand over (kun quiz + katalog).';
    return;
  end if;

  select id into v_owner from app_user where email = v_email;
  if v_owner is null then
    raise exception '[seed] ingen app_user med e-mail % — opret ejeren via /signup først (docs/opsaetning-ejer-test.md, trin 4).', v_email;
  end if;

  -- Demodata må ikke blandes med rigtige: en ejer der allerede har et board, afvises.
  if exists (select 1 from board where owner_id = v_owner and id <> v_board) then
    raise exception '[seed] ejeren % har allerede et board — den befolkede tilstand kræver en ejer uden board (brug en frisk signup).', v_email;
  end if;

  -- Ejerens quiz-svar: churn, priser, økonomi + hver 4. uge. Matcher de tre partnere nedenfor.
  insert into quiz_answer (id, owner_id, quiz_option_id) values
    ('d0000000-0000-4000-8000-000000000801', v_owner, 'd0000000-0000-4000-8000-000000000201'),
    ('d0000000-0000-4000-8000-000000000802', v_owner, 'd0000000-0000-4000-8000-000000000202'),
    ('d0000000-0000-4000-8000-000000000803', v_owner, 'd0000000-0000-4000-8000-000000000204'),
    ('d0000000-0000-4000-8000-000000000804', v_owner, 'd0000000-0000-4000-8000-000000000221')
  on conflict do nothing;

  -- Board + tre partnere. Lead på den første interne — samme pladsholder som approveBoard.
  -- TODO(ejer): lead-partner regler.
  insert into board (id, owner_id, name) values (v_board, v_owner, 'Mit board')
  on conflict (id) do nothing;

  insert into board_partner (board_id, partner_id, is_lead) values
    (v_board, v_astrid,  true),
    (v_board, v_mikkel,  false),
    (v_board, v_camilla, false)
  on conflict do nothing;

  -- Medlemskab med demo-kort — samme tilstandsskift som confirmDemoCard (ADR 0041).
  insert into membership (id, board_id, frequency_weeks, status, provider_customer_ref, card_status) values
    (v_membership, v_board, 4, 'aktiv', 'DEMO-CUSTOMER-' || v_membership::text, 'registreret')
  on conflict (id) do nothing;

  -- Prisregel: kun hvis ingen aktiv findes (se advarslen ovenfor).
  if not exists (select 1 from pricing_rule where is_active) then
    insert into pricing_rule (id, version, base_amount_minor, per_partner_amount_minor,
                              factor_4_weeks, factor_8_weeks, factor_12_weeks, currency, is_active)
    select v_rule, coalesce(max(version), 0) + 1, 100, 100, 1, 1, 1, 'DKK', true
    from pricing_rule
    on conflict (id) do nothing;
  end if;

  -- Kommende møde (planlagt). starts_at opdateres ved gentagne kørsler, så det forbliver i fremtiden.
  insert into meeting (id, board_id, provider_booking_uid, starts_at, status, video_join_url) values
    (v_meeting_next, v_board, 'DEMO-BOOKING-SEED-0701', v_next_start, 'planlagt', '/moeder/rum/DEMO-BOOKING-SEED-0701')
  on conflict (id) do update set starts_at = excluded.starts_at, updated_at = now();

  -- Afholdt møde, 19 dage tilbage; alle tre partnere registreret som afholdt.
  insert into meeting (id, board_id, provider_booking_uid, starts_at, status, video_join_url) values
    (v_meeting_held, v_board, 'DEMO-BOOKING-SEED-0702', v_held_start, 'afholdt', '/moeder/rum/DEMO-BOOKING-SEED-0702')
  on conflict (id) do update set starts_at = excluded.starts_at, updated_at = now();

  insert into meeting_partner (meeting_id, partner_profile_id, registered_status, registered_at) values
    (v_meeting_next, v_astrid,  null, null),
    (v_meeting_next, v_mikkel,  null, null),
    (v_meeting_next, v_camilla, null, null),
    (v_meeting_held, v_astrid,  'afholdt', v_held_start + interval '75 minutes'),
    (v_meeting_held, v_mikkel,  'afholdt', v_held_start + interval '75 minutes'),
    (v_meeting_held, v_camilla, 'afholdt', v_held_start + interval '75 minutes')
  on conflict (meeting_id, partner_profile_id) do update
    set registered_status = excluded.registered_status, registered_at = excluded.registered_at;

  -- Dagsorden på det kommende møde (ejerens forberedelse, fase 4.1).
  insert into meeting_agenda_item (id, meeting_id, kind, body, sort_order) values
    ('d0000000-0000-4000-8000-000000000901', v_meeting_next, 'dagsorden',   'Status på fastholdelse: hvad har vi ændret siden sidst, og hvad viser tallene?', 1),
    ('d0000000-0000-4000-8000-000000000902', v_meeting_next, 'dagsorden',   'Prispakkerne: skal vi forenkle til to, og hvad gør vi med de eksisterende kunder?', 2),
    ('d0000000-0000-4000-8000-000000000903', v_meeting_next, 'spoergsmaal', 'Hvilke tre nøgletal bør jeg kigge på hver mandag morgen?', 1),
    ('d0000000-0000-4000-8000-000000000904', v_meeting_next, 'materiale',   'Seneste kvartalsoversigt og churn-opgørelsen — sendes på mail inden mødet.', 1)
  on conflict (id) do nothing;

  -- Efter-møde-note fra Mikkel på det afholdte møde (fase 2.4).
  insert into meeting_note (id, meeting_id, partner_profile_id, body) values
    ('d0000000-0000-4000-8000-000000000a01', v_meeting_held, v_mikkel,
     'Vi blev enige om at starte med likviditetsoverblikket. Ejeren sender nøgletallene inden næste møde, så vi kan gå direkte til prioriteringen.')
  on conflict do nothing;

  -- Ejerens vurderinger af det afholdte møde: mødet som helhed + Mikkel (fase 4.2).
  insert into meeting_rating (id, meeting_id, rater_user_id, subject_partner_profile_id, score, comment) values
    ('d0000000-0000-4000-8000-000000000a11', v_meeting_held, v_owner, null,     5, 'Konkret og brugbart — vi fik prioriteret.'),
    ('d0000000-0000-4000-8000-000000000a12', v_meeting_held, v_owner, v_mikkel, 4, null)
  on conflict do nothing;

  -- Opkrævning for det afholdte møde — kun hvis demo-reglen er den aktive. Beløbet følger
  -- formlen (base + 3 × pr. partner) × faktor_4 = (100 + 300) × 1,0 = 400 øre, præcis som
  -- createChargeForMeeting ville regne. 'rapporteret' = indberettet, afregnes på næste faktura.
  if exists (select 1 from pricing_rule where id = v_rule and is_active) then
    insert into payment_charge (id, meeting_id, membership_id, pricing_rule_id, amount_minor, currency, status, provider_charge_ref) values
      ('d0000000-0000-4000-8000-000000000b01', v_meeting_held, v_membership, v_rule, 400, 'DKK', 'rapporteret', 'DEMO-CHARGE-SEED-0702')
    on conflict do nothing;
  end if;
end $$;

commit;
