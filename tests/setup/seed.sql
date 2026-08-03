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

insert into board (id, owner_id, name) values
  ('00000000-0000-0000-0000-0000000b0a4d', '00000000-0000-0000-0000-00000000000a', 'A''s board');

insert into board_partner (board_id, partner_id, is_lead) values
  ('00000000-0000-0000-0000-0000000b0a4d', '00000000-0000-0000-0000-00000000000b', true);

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

-- Partner-katalog-seed (til partner_profile-RLS-tests): to admin-forfattede profiler + én tag-kobling.
insert into partner_profile (id, name, title, is_internal, sort_order) values
  ('00000000-0000-0000-0000-0000000e0001', 'Partner Én',  'Rådgiver', true,  1),
  ('00000000-0000-0000-0000-0000000e0002', 'Partner To',  'Rådgiver', false, 2);

insert into partner_profile_competence_tag (partner_profile_id, competence_tag_id)
  select '00000000-0000-0000-0000-0000000e0001', id from competence_tag where slug = 'salg-og-marketing';
