-- Fase 0, Trin 2 — rolle-enum + bruger↔rolle-relation. Ingen forretningstabeller endnu.
-- Navnekonvention: snake_case, ental tabelnavne, FK som <tabel>_id. Se docs/adr/0006-*.md.

create type user_role as enum ('ejer', 'partner', 'lead_partner', 'admin');

create table app_user (
  -- = auth.uid() (Supabase auth.users.id). Ingen hård FK til auth.users her, så
  -- schemaet kan køre uændret både lokalt (ren Postgres) og på Supabase.
  id uuid primary key,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table user_role_assignment (
  user_id uuid not null references app_user(id) on delete cascade,
  role user_role not null,
  primary key (user_id, role)
);
