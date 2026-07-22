-- Fase 1.2 — quiz-schema (admin-forfattet quiz). Byggespec §5.2/§6.
-- Naming: ADR 0006 (ental, snake_case, FK <tabel>_id). RLS: ADR 0007 (policies i migrationen,
-- <tabel>_<operation>_<rolle>, idempotent). Mønster: admin ser alt, authed ejer ser kun published,
-- writes via service-role (ingen write-policy). Genbruger has_role() + competence_tag (0005).

create type quiz_question_kind as enum ('single', 'multi');
create type quiz_option_kind as enum ('tag', 'free_text', 'frequency');

create table quiz_question (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,                          -- stabil ref (fx 'kompetencer'/'frekvens') til 1.3/1.5
  prompt text not null,
  kind quiz_question_kind not null,
  sort_order int not null default 0,
  is_published boolean not null default false,       -- draft/published; ejer-flow (1.3) ser kun published
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table quiz_option (
  id uuid primary key default gen_random_uuid(),
  quiz_question_id uuid not null references quiz_question(id) on delete cascade,
  label text not null,
  kind quiz_option_kind not null,                    -- tag | free_text | frequency
  frequency_weeks int,                               -- kun for frekvens-options (4/8/12)
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint quiz_option_frequency_only check (frequency_weeks is null or kind = 'frequency')
);

-- Kobling svar → kompetence (byggespec §6 quiz_option_skills). Kun 'tag'-options får rækker;
-- frekvens/fritekst har ingen. Dette er hvad 1.5 matching konsumerer.
create table quiz_option_competence_tag (
  quiz_option_id uuid not null references quiz_option(id) on delete cascade,
  competence_tag_id uuid not null references competence_tag(id) on delete cascade,
  primary key (quiz_option_id, competence_tag_id)
);

-- --- RLS ---
alter table quiz_question enable row level security;
alter table quiz_option enable row level security;
alter table quiz_option_competence_tag enable row level security;

-- quiz_question: admin ser alt (også drafts); enhver authed ser published.
drop policy if exists quiz_question_select_admin on quiz_question;
create policy quiz_question_select_admin on quiz_question
  for select using (has_role('admin'));
drop policy if exists quiz_question_select_published on quiz_question;
create policy quiz_question_select_published on quiz_question
  for select using (is_published and auth.uid() is not null);

-- quiz_option: admin ser alt; published hvis forælder-spørgsmålet er published.
drop policy if exists quiz_option_select_admin on quiz_option;
create policy quiz_option_select_admin on quiz_option
  for select using (has_role('admin'));
drop policy if exists quiz_option_select_published on quiz_option;
create policy quiz_option_select_published on quiz_option
  for select using (
    auth.uid() is not null and exists (
      select 1 from quiz_question q
      where q.id = quiz_option.quiz_question_id and q.is_published
    )
  );

-- quiz_option_competence_tag: admin ser alt; published via option → spørgsmål.
drop policy if exists quiz_option_competence_tag_select_admin on quiz_option_competence_tag;
create policy quiz_option_competence_tag_select_admin on quiz_option_competence_tag
  for select using (has_role('admin'));
drop policy if exists quiz_option_competence_tag_select_published on quiz_option_competence_tag;
create policy quiz_option_competence_tag_select_published on quiz_option_competence_tag
  for select using (
    auth.uid() is not null and exists (
      select 1 from quiz_option o
      join quiz_question q on q.id = o.quiz_question_id
      where o.id = quiz_option_competence_tag.quiz_option_id and q.is_published
    )
  );
