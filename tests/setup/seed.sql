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
