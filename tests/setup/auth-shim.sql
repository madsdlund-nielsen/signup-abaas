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

-- Minimal stand-in for Supabase' auth.users (som findes i forvejen i prod). Kun de kolonner
-- vi rører: id. Lader betingede triggere på auth.users (fx sletning-cascade i 0004) blive
-- oprettet og dækket af db-tests lokalt.
create table if not exists auth.users (id uuid primary key);
