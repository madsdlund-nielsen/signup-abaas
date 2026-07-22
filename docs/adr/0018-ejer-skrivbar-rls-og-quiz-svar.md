# 0018 — Ejer-skrivbar RLS + quiz-svar-datamodel

- **Status:** Accepteret
- **Dato:** 2026-07-22
- **Fase:** 1
- **Berører uafklaret punkt:** nej (fanger kun kompetence-signalet; matching/anbefaling/pris er 1.5/1.6/fase 3)

## Kontekst

Fase 1.3 er ejer-onboarding: en logget-ind ejer gennemgår den publicerede quiz, og svarene skal
persisteres som et **kompetence-signal** til 1.5-matching. To valg skal træffes: (1) hvordan
svarene modelleres, og (2) hvordan de skrives. Indtil nu er ALLE writes i repoet admin-writes via
service-role bag `requireRole('admin')` (ADR 0016) — der findes endnu ingen ejer-skrivbar tabel og
ingen RLS *write*-policy. CLAUDE.md princip 5: "RLS er det primære autorisationslag."

## Overvejede muligheder

**Datamodel**
- **A — én række pr. valgt option** (`quiz_answer(owner_id, quiz_option_id, free_text)`): normaliseret;
  multi-valg = flere rækker; spørgsmåls-id udledes via option→question; kompetence-signal =
  join til `quiz_option_competence_tag`. Frekvens = join til `quiz_option.frequency_weeks`.
- **B — JSON-blob pr. ejer** (`quiz_response(owner_id, answers jsonb)`): færre rækker, men matching
  (1.5) skal parse JSON og kan ikke joine i SQL; svær at RLS'e/validere pr. svar.

**Skrivevej**
- **A — authed klient + RLS-with-check**: ejeren skriver egne rækker; `owner_id = auth.uid()`
  håndhæves i selve autorisationslaget.
- **B — service-role bag `requireRole('ejer')`**: samme app-guard som admin, men RLS bypasses;
  ejer-ejerskab håndhæves kun i app-koden.

## Beslutning

**Datamodel A + skrivevej A.** `quiz_answer(id, owner_id → app_user, quiz_option_id → quiz_option,
free_text, created_at)`, `unique(owner_id, quiz_option_id)`. Skrives via den **authed** klient;
RLS-policies (migration 0008): `select_owner`/`select_admin`, `insert_owner`
`with check (owner_id = auth.uid() and option hører til et published spørgsmål)`, `delete_owner`.
Ingen update — replace-whole-set (delete egne → insert nye). App-lags-`requireRole('ejer')` beholdes
som forsvar-i-dybden. Dette er den **første ejer-skrivbare tabel** og det første RLS-write-mønster;
det realiserer CLAUDE.md princip 5 (RLS som primært autorisationslag) frem for kun app-logik.

Den normaliserede form giver 1.5 et rent SQL-signal (`join quiz_option_competence_tag`) uden JSON-
parsing, og `is_published`-tjekket i insert-policyen forhindrer svar mod kladdespørgsmål allerede i
databasen.

## Konsekvenser

- **Positive:** ejer-selvbetjening håndhæves i databasen (ikke kun app-koden); 1.5 læser et join-bart
  kompetence-signal; genbruger `quiz_option`/`quiz_option_competence_tag`/`competence_tag` uændret.
- **Negative / pris:** to skrivemønstre i repoet nu (admin=service-role, ejer=authed+RLS) — skal
  holdes tydeligt adskilt. Replace-whole-set er en fuld delete+insert pr. gem (fint ved quiz-skala).
- **Opfølgning:** 1.5 matching konsumerer signalet (`// senere`); fritekst-svar gemmes men bruges
  ikke til matching endnu; ingen board/anbefaling/pris i 1.3. Fremtidige ejer-skrivbare tabeller
  følger dette RLS-write-mønster.
