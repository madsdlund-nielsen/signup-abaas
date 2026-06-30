-- TEST-ONLY: lokal emulering af Supabase' auth.uid().
-- På Supabase findes auth-skemaet og auth.uid() i forvejen; denne shim bruges KUN
-- i test mod en ren Postgres, så de samme RLS-policies kan køre uændret lokalt.

create schema if not exists auth;

create or replace function auth.uid() returns uuid
  language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to public;
