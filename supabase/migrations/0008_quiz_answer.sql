-- Fase 1.3 — ejer-svar på quizzen (kompetence-signal til matching). Byggespec §5.2, ADR 0018.
-- Naming: ADR 0006 (ental, snake_case, FK <tabel>_id). RLS: ADR 0007 (policies i migrationen,
-- <tabel>_<operation>_<rolle>, idempotent). DETTE ER DEN FØRSTE EJER-SKRIVBARE TABEL: modsat
-- quiz/tags (writes kun via service-role bag admin) skriver ejeren HER sine egne svar via den
-- authed klient, håndhævet af RLS-with-check (owner_id = auth.uid()). Se ADR 0018.

-- Én række pr. valgt option (multi-valg → flere rækker). Spørgsmåls-id udledes via option→question.
create table quiz_answer (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references app_user(id) on delete cascade,     -- = auth.uid()
  quiz_option_id uuid not null references quiz_option(id) on delete cascade,
  free_text text,                                                       -- kun for free_text-options
  created_at timestamptz not null default now(),
  unique (owner_id, quiz_option_id)                                     -- idempotent replace-whole-set
);

-- 1.5 matching læser kompetence-signalet:
--   select competence_tag_id from quiz_answer join quiz_option_competence_tag using (quiz_option_id)
--   where owner_id = <ejer>;  -- frekvens: join quiz_option.frequency_weeks.
create index quiz_answer_owner_idx on quiz_answer (owner_id);

-- --- RLS ---
alter table quiz_answer enable row level security;

-- Ejer ser kun egne svar; admin ser alt (read-only — til 1.5/AI senere).
drop policy if exists quiz_answer_select_owner on quiz_answer;
create policy quiz_answer_select_owner on quiz_answer
  for select using (owner_id = auth.uid());
drop policy if exists quiz_answer_select_admin on quiz_answer;
create policy quiz_answer_select_admin on quiz_answer
  for select using (has_role('admin'));

-- Ejer skriver KUN egne svar, og kun mod PUBLISHED spørgsmål (integritet i selve autorisationslaget).
drop policy if exists quiz_answer_insert_owner on quiz_answer;
create policy quiz_answer_insert_owner on quiz_answer
  for insert with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from quiz_option o
      join quiz_question q on q.id = o.quiz_question_id
      where o.id = quiz_answer.quiz_option_id and q.is_published
    )
  );

-- Ejer kan rydde/erstatte egne svar (replace-whole-set = delete + insert; ingen update-policy).
drop policy if exists quiz_answer_delete_owner on quiz_answer;
create policy quiz_answer_delete_owner on quiz_answer
  for delete using (owner_id = auth.uid());
