-- TEST-ONLY: app-rolle der emulerer Supabase 'authenticated'. RLS håndhæves fordi
-- rollen hverken ejer tabellerne eller er superuser.
do $$
begin
  if not exists (select from pg_roles where rolname = 'app_authenticated') then
    create role app_authenticated nologin;
  end if;
end $$;

grant usage on schema public to app_authenticated;
grant select, insert, update, delete on all tables in schema public to app_authenticated;

-- Seed (indsættes som superuser → RLS bypasses her).
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ejer-a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'partner-b@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'partner-c@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'admin-d@example.com'),
  ('00000000-0000-0000-0000-00000000000e', 'ejer-e@example.com');

insert into user_role_assignment (user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', 'ejer'),
  ('00000000-0000-0000-0000-00000000000b', 'partner'),
  ('00000000-0000-0000-0000-00000000000c', 'partner'),
  ('00000000-0000-0000-0000-00000000000d', 'admin'),
  ('00000000-0000-0000-0000-00000000000e', 'ejer');

-- Partner-katalog-seed. Ligger FØR board_partner, som siden 0010 refererer partner_profile(id)
-- i stedet for app_user(id). Fire profiler: Én er tagget salg (og sidder på A's board), To er
-- utagget pulje-støj, Tre dækker økonomi, Fire dækker begge (så set-cover kan vælge 1 vs. 2).
-- Partner-login (0011): profil Én er koblet til auth-bruger partner-B (app_user_id).
-- Partner-C har BEVIDST ingen katalogkobling → negativ-case for partner-synlighed.
insert into partner_profile (id, name, title, is_internal, sort_order, app_user_id) values
  ('00000000-0000-0000-0000-0000000e0001', 'Partner Én',   'Rådgiver', true,  1, '00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-0000000e0002', 'Partner To',   'Rådgiver', false, 2, null),
  ('00000000-0000-0000-0000-0000000e0003', 'Partner Tre',  'Rådgiver', true,  3, null),
  ('00000000-0000-0000-0000-0000000e0004', 'Partner Fire', 'Rådgiver', false, 4, null);

insert into partner_profile_competence_tag (partner_profile_id, competence_tag_id)
  select '00000000-0000-0000-0000-0000000e0001', id from competence_tag where slug = 'salg-og-marketing';
insert into partner_profile_competence_tag (partner_profile_id, competence_tag_id)
  select '00000000-0000-0000-0000-0000000e0003', id from competence_tag where slug = 'oekonomi-og-noegletal';
insert into partner_profile_competence_tag (partner_profile_id, competence_tag_id)
  select '00000000-0000-0000-0000-0000000e0004', id from competence_tag
  where slug in ('salg-og-marketing', 'oekonomi-og-noegletal');

insert into board (id, owner_id, name) values
  ('00000000-0000-0000-0000-0000000b0a4d', '00000000-0000-0000-0000-00000000000a', 'A''s board');

-- Partner Én sidder på A's board som lead. Profil To/Tre/Fire er UDEN for boardet → negativ-cases
-- for ejer-read-policyen (ejeren må kun se katalogposter der sidder på hendes eget board).
insert into board_partner (board_id, partner_id, is_lead) values
  ('00000000-0000-0000-0000-0000000b0a4d', '00000000-0000-0000-0000-0000000e0001', true);

-- Quiz-seed (til RLS-tests): ét published + ét draft spørgsmål, én option + én tag-mapping.
insert into quiz_question (id, key, prompt, kind, sort_order, is_published) values
  ('00000000-0000-0000-0000-0000000c0001', 'kompetencer',    'Hvilke kompetencer ønsker du?', 'multi',  1, true),
  ('00000000-0000-0000-0000-0000000c0002', 'kladde-spoergsmaal', 'Kladde-spørgsmål',          'single', 2, false);

insert into quiz_option (id, quiz_question_id, label, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000c0a01', '00000000-0000-0000-0000-0000000c0001', 'Salg og marketing', 'tag', 1),
  ('00000000-0000-0000-0000-0000000c0a02', '00000000-0000-0000-0000-0000000c0002', 'Kladde-svar',       'tag', 1);

insert into quiz_option_competence_tag (quiz_option_id, competence_tag_id)
  select '00000000-0000-0000-0000-0000000c0a01', id from competence_tag where slug = 'salg-og-marketing';
insert into quiz_option_competence_tag (quiz_option_id, competence_tag_id)
  select '00000000-0000-0000-0000-0000000c0a02', id from competence_tag where slug = 'oekonomi-og-noegletal';

-- Ejer-svar-seed (til quiz_answer-RLS-tests): ejer-A har svaret på den published option c0a01.
-- Indsættes som superuser → RLS-with-check bypasses her. Ejer-E har bevidst INGEN svar (isolation).
insert into quiz_answer (id, owner_id, quiz_option_id) values
  ('00000000-0000-0000-0000-0000000d0a01', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000c0a01');

-- Møde-seed (0012, til meeting-RLS-tests): to møder på A's board — ét planlagt (fremtid),
-- ét afholdt (fortid, registrering åben). Partner Én deltager i begge; note på det afholdte.
insert into meeting (id, board_id, starts_at, status) values
  ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000b0a4d', '2026-09-01T10:00:00Z', 'planlagt'),
  ('00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-0000000b0a4d', '2026-07-01T10:00:00Z', 'afholdt');

insert into meeting_partner (meeting_id, partner_profile_id) values
  ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000e0001'),
  ('00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-0000000e0001');

insert into meeting_note (id, meeting_id, partner_profile_id, body) values
  ('00000000-0000-0000-0000-0000000f0a01', '00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-0000000e0001', 'Note fra Partner Én');

-- Betalings-seed (0013): ejer-A's membership på boardet, frekvens 4 (strukturel enum-værdi,
-- ikke et forretningstal). INGEN pricing_rule-seed — tal indtastes af admin i prod, og
-- RLS-tests indsætter egne rækker i transaktioner der rulles tilbage (stub-politik).
insert into membership (id, board_id, frequency_weeks) values
  ('00000000-0000-0000-0000-0000000ba001', '00000000-0000-0000-0000-0000000b0a4d', 4);

-- Forberedelses- og rating-seed (0015, fase 4.1/4.2).
-- Dagsorden på begge møder: DELT synlighed, så både ejer-A og partner-B skal se alle tre.
insert into meeting_agenda_item (id, meeting_id, kind, body, sort_order) values
  ('00000000-0000-0000-0000-0000000a1a01', '00000000-0000-0000-0000-0000000f0001', 'dagsorden',   'Gennemgang af kvartalet', 1),
  ('00000000-0000-0000-0000-0000000a1a02', '00000000-0000-0000-0000-0000000f0001', 'spoergsmaal', 'Hvor skal vi prioritere?', 1),
  ('00000000-0000-0000-0000-0000000a1a03', '00000000-0000-0000-0000-0000000f0002', 'dagsorden',   'Opfølgning på sidste møde', 1);

-- Forberedelsesnote af Partner Én (koblet til partner-B): PRIVAT. Ejer-A må IKKE se den —
-- det er den centrale negative case for 4.1's synlighedsvalg.
insert into meeting_prep_note (id, meeting_id, partner_profile_id, body) values
  ('00000000-0000-0000-0000-0000000b1b01', '00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000e0001', 'Min egen forberedelse');

-- Vurderinger på det AFHOLDTE møde f0002. Ejer-A vurderer både mødet som helhed (subject
-- null) og Partner Én; Partner Én vurderer mødet. Partner-B må kun se sin egen — altså IKKE
-- ejer-A's vurdering AF Partner Én. Det er 4.2's "ikke en offentlig score" i praksis.
insert into meeting_rating (id, meeting_id, rater_user_id, rater_partner_profile_id, subject_partner_profile_id, score, comment) values
  ('00000000-0000-0000-0000-0000000c1c01', '00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-00000000000a', null, null, 5, 'Godt møde'),
  ('00000000-0000-0000-0000-0000000c1c02', '00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-00000000000a', null, '00000000-0000-0000-0000-0000000e0001', 4, null),
  ('00000000-0000-0000-0000-0000000c1c03', '00000000-0000-0000-0000-0000000f0002', null, '00000000-0000-0000-0000-0000000e0001', null, 4, null);
