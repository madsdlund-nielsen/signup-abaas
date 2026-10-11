-- Fase 4.4 / backlog B-45 — AI-mødeopsummeringen som mødeartefakt (ADR 0059).
-- Naming: ADR 0006 (ental, snake_case, FK <tabel>_id). RLS: ADR 0007 (policies i migrationen,
-- <tabel>_<operation>_<rolle>, idempotent).
--
-- Hvorfor en tabel: resuméet blev før genereret ved hver sidevisning (transskription + LLM mod
-- en betalt leverandør). Nu genereres det ÉN gang af en baggrundskørsel og gemmes her; siden
-- læser kun denne række. Rækken er også kø-tilstanden: status er livscyklussen, så kørslen er
-- idempotent (en betinget status-overgang afventer → genereres er låsen).
--
-- DATAMINIMERING: det rå transskript gemmes IKKE. Det er personfølsomt, resuméet er det ejeren
-- skal bruge, og transskriptet kan genskabes fra optagelsen så længe den findes. Der er derfor
-- hverken en transcript-kolonne eller en transcript_ref (ingen lagring at pege på).
--
-- Mødet ER grænsen: én række pr. møde (unique), slettes med mødet (cascade — GDPR-sletteflowet).

create type meeting_summary_status as enum (
  'afventer',            -- oprettet, ikke påbegyndt (eller sat tilbage efter en fejl der kan prøves igen)
  'genereres',           -- en kørsel har låst rækken
  'klar',                -- resumé gemt
  'fejlet',              -- opgivet efter det tilladte antal forsøg — kræver "Generér igen"
  'mangler_samtykke',    -- ingen registreret optagelsessamtykke: der hentes og sendes intet
  'mangler_optagelse'    -- samtykke findes, men der er ingen optagelse at transskribere
);

create table meeting_summary (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null unique references meeting(id) on delete cascade,
  status meeting_summary_status not null default 'afventer',
  summary text,
  action_items jsonb not null default '[]'::jsonb,
  -- Audit: hvilken adapter/model skrev teksten ('demo' for demo-adapteren, ADR 0041).
  provider text,
  model text,
  -- Kun en kort fejlkode/-klasse — aldrig leverandørens svartekst eller transskript.
  error text,
  attempts int not null default 0 check (attempts >= 0),
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint meeting_summary_action_items_array check (jsonb_typeof(action_items) = 'array'),
  -- En 'klar' række har et resumé og et tidspunkt; ellers er tilstanden ødelagt.
  constraint meeting_summary_klar_has_text
    check (status <> 'klar' or (summary is not null and generated_at is not null))
);

-- Kørslen finder arbejde på status (+ ældste først).
create index meeting_summary_status_idx on meeting_summary (status, created_at);

-- --- RLS ---------------------------------------------------------------------------------

alter table meeting_summary enable row level security;

-- RESTRIKTIV default: boardets ejer + admin. Partnere ser den IKKE (endnu).
-- Reglen boede før i siden `/moeder/[id]` (stub-registret: "når resuméet får en tabel,
-- flytter reglen til RLS") — nu er den i RLS, det primære autorisationslag.
-- TODO(ejer): note-synlighed (§12 pkt. 16) — gælder også resuméer. Udvidelse til partnerne
-- på boardet er én ekstra policy (is_partner_on_board, som meeting_agenda_item_select_partner).
drop policy if exists meeting_summary_select_owner on meeting_summary;
create policy meeting_summary_select_owner on meeting_summary
  for select using (
    exists (
      select 1 from meeting m join board b on b.id = m.board_id
      where m.id = meeting_summary.meeting_id and b.owner_id = auth.uid()
    )
  );

drop policy if exists meeting_summary_select_admin on meeting_summary;
create policy meeting_summary_select_admin on meeting_summary
  for select using (has_role('admin'));

-- Ingen write-policies: alle writes går via service-role — baggrundskørslen
-- (src/server/summaries/generate.ts) og "Generér igen" bag ejerskabstjek (actions.ts).
