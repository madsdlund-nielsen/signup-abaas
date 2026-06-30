-- Fase 0 — minimal forretningstabel der demonstrerer RLS-mønstret (Trin 5).
-- Boardet holdes livscyklus-agnostisk indtil ejer beslutter board-livscyklus.
-- TODO(ejer): board-livscyklus (hvornår slutter et board).

create table board (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references app_user(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table board_partner (
  board_id uuid not null references board(id) on delete cascade,
  partner_id uuid not null references app_user(id) on delete cascade,
  -- lead-partner-flag: mindst 1 pr. board. TODO(ejer): tildelings-/rotationsregler.
  is_lead boolean not null default false,
  primary key (board_id, partner_id)
);

-- RLS aktiv fra første forretningstabel (arkitekturprincip 5 i CLAUDE.md).
alter table board enable row level security;
