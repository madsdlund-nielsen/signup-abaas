-- ---------------------------------------------------------------------------------------
-- DEMODATA til ejer-test — IKKE en migration, IKKE produktionsdata.
--
-- Formål: at ejerne åbner appen og møder en udfyldt quiz og et partnerkatalog i stedet for
-- tomme skærme. Migrationerne opretter kun de otte kanoniske kompetence-tags (0005);
-- quiz og katalog er tomme fra start, og admin ville ellers skulle taste alt manuelt.
--
-- KØRSEL:  npm run db:seed:demo      (kræver DATABASE_URL)
-- FJERN:   npm run db:seed:demo:clean
--
-- Idempotent: alle rækker har FASTE uuid'er i d0000000-…-serien, så gentagne kørsler ikke
-- duplikerer, og oprydning er en enkelt sletning på id-præfiks.
--
-- ⚠ HVAD DER BEVIDST IKKE SEEDES:
--   * `pricing_rule` — priser er ejer-territorium (§12 pkt. 2). `docs/stub-politik.md`
--     forbyder et plausibelt forretningstal i koden, også som demodata. Admin taster den
--     første prisregel i /admin/priser.
--   * `partner_profile.app_user_id` — demopartnere har intet login. Rigtige partnere
--     inviteres af admin (ADR 0025).
--   * auth-brugere og roller — de kan ikke oprettes i SQL. Se docs/opsaetning-ejer-test.md.
-- ---------------------------------------------------------------------------------------

begin;

-- --- Quiz: ét kompetence-spørgsmål (multi) + ét frekvens-spørgsmål (single) ---------------

insert into quiz_question (id, key, prompt, kind, sort_order, is_published) values
  ('d0000000-0000-4000-8000-000000000101', 'udfordringer',
   'Hvor har din virksomhed mest brug for sparring lige nu?', 'multi', 1, true),
  ('d0000000-0000-4000-8000-000000000102', 'frekvens',
   'Hvor ofte vil du mødes med dit advisory board?', 'single', 2, true)
on conflict (id) do nothing;

-- Kompetence-options: én pr. kanonisk tag (0005) + en fritekst til "noget andet".
insert into quiz_option (id, quiz_question_id, label, kind, frequency_weeks, sort_order) values
  ('d0000000-0000-4000-8000-000000000201', 'd0000000-0000-4000-8000-000000000101', 'Vi mister kunder — fastholdelse og churn',        'tag',       null, 1),
  ('d0000000-0000-4000-8000-000000000202', 'd0000000-0000-4000-8000-000000000101', 'Vi er i tvivl om vores priser og pakker',          'tag',       null, 2),
  ('d0000000-0000-4000-8000-000000000203', 'd0000000-0000-4000-8000-000000000101', 'Vi skal sælge mere — salg og marketing',           'tag',       null, 3),
  ('d0000000-0000-4000-8000-000000000204', 'd0000000-0000-4000-8000-000000000101', 'Vi mangler overblik over økonomi og nøgletal',     'tag',       null, 4),
  ('d0000000-0000-4000-8000-000000000205', 'd0000000-0000-4000-8000-000000000101', 'Vi står utydeligt — positionering og kommunikation','tag',      null, 5),
  ('d0000000-0000-4000-8000-000000000206', 'd0000000-0000-4000-8000-000000000101', 'Vi skal skalere, rejse kapital eller sælge',       'tag',       null, 6),
  ('d0000000-0000-4000-8000-000000000207', 'd0000000-0000-4000-8000-000000000101', 'Vi skal have mere ud af tech, automatisering og AI','tag',      null, 7),
  ('d0000000-0000-4000-8000-000000000208', 'd0000000-0000-4000-8000-000000000101', 'Vi vil ud på nye markeder',                        'tag',       null, 8),
  ('d0000000-0000-4000-8000-000000000209', 'd0000000-0000-4000-8000-000000000101', 'Noget andet — skriv gerne kort',                   'free_text', null, 9),
  ('d0000000-0000-4000-8000-000000000221', 'd0000000-0000-4000-8000-000000000102', 'Hver 4. uge',                                      'frequency',    4, 1),
  ('d0000000-0000-4000-8000-000000000222', 'd0000000-0000-4000-8000-000000000102', 'Hver 8. uge',                                      'frequency',    8, 2),
  ('d0000000-0000-4000-8000-000000000223', 'd0000000-0000-4000-8000-000000000102', 'Hver 12. uge',                                     'frequency',   12, 3)
on conflict (id) do nothing;

-- Kobling option → kompetence-tag. Dette er hvad board-matchingen (ADR 0022) konsumerer.
insert into quiz_option_competence_tag (quiz_option_id, competence_tag_id)
select o.id, t.id
from (values
  ('d0000000-0000-4000-8000-000000000201'::uuid, 'fastholdelse-og-churn'),
  ('d0000000-0000-4000-8000-000000000202'::uuid, 'prissaetning-og-pakker'),
  ('d0000000-0000-4000-8000-000000000203'::uuid, 'salg-og-marketing'),
  ('d0000000-0000-4000-8000-000000000204'::uuid, 'oekonomi-og-noegletal'),
  ('d0000000-0000-4000-8000-000000000205'::uuid, 'positionering-og-kommunikation'),
  ('d0000000-0000-4000-8000-000000000206'::uuid, 'skalering-funding-og-exit'),
  ('d0000000-0000-4000-8000-000000000207'::uuid, 'tech-automatisering-og-ai'),
  ('d0000000-0000-4000-8000-000000000208'::uuid, 'udland-nye-markeder')
) as m(option_id, tag_slug)
join quiz_option o on o.id = m.option_id
join competence_tag t on t.slug = m.tag_slug
on conflict do nothing;

-- --- Partnerkatalog: seks demoprofiler ---------------------------------------------------
-- Navnene er opdigtede. `long_bio` starter med "Demoprofil", så ingen forveksler dem med
-- rigtige rådgivere. Dækningen er valgt så matchingen har noget reelt at arbejde med:
-- hvert tag er dækket mindst én gang, og der er overlap, så tie-break faktisk udløses.

insert into partner_profile (id, name, title, is_internal, languages, short_bio, long_bio, sort_order) values
  ('d0000000-0000-4000-8000-000000000301', 'Astrid Nørgaard', 'Kommerciel direktør', true,  'Dansk, engelsk',
   'Har skaleret to SaaS-forretninger fra 5 til 50 medarbejdere.',
   'Demoprofil (testdata). Arbejder med kommerciel struktur: prissætning, pakketering og den svære overgang fra grundlægger-salg til et rigtigt salgsteam.', 1),
  ('d0000000-0000-4000-8000-000000000302', 'Mikkel Bang Sørensen', 'CFO og bestyrelsesrådgiver', true, 'Dansk, engelsk',
   'Tidligere CFO i to vækstvirksomheder, nu fast bestyrelsesmedlem.',
   'Demoprofil (testdata). Fokus på nøgletal ejeren faktisk kan styre efter, likviditet i vækst, og hvad en investor kigger efter længe før en runde.', 2),
  ('d0000000-0000-4000-8000-000000000303', 'Leila Haddad', 'Marketingstrateg', true, 'Dansk, engelsk, fransk',
   'Bygger positionering for B2B-virksomheder der lyder som alle andre.',
   'Demoprofil (testdata). Arbejder med positionering og budskaber — hvorfor kunder vælger jer frem for den næste på listen, og hvordan det bliver hørbart.', 3),
  ('d0000000-0000-4000-8000-000000000304', 'Jonas Vestergaard', 'Tech- og AI-rådgiver', true, 'Dansk, engelsk',
   'Automatiserer drift i virksomheder uden egen udviklingsafdeling.',
   'Demoprofil (testdata). Ser på hvor teknologi reelt flytter marginalen — og hvor den mest bliver et projekt der aldrig bliver færdigt.', 4),
  ('d0000000-0000-4000-8000-000000000305', 'Camilla Riis', 'Kundechef og churn-specialist', false, 'Dansk, engelsk',
   'Har halveret churn i to abonnementsforretninger.',
   'Demoprofil (testdata). Arbejder med fastholdelse som en systematisk disciplin frem for en kampagne: onboarding, tidlige varselstegn og gensalg.', 5),
  ('d0000000-0000-4000-8000-000000000306', 'Peter Lundgaard', 'Eksportrådgiver', false, 'Dansk, engelsk, tysk',
   'Har åbnet DACH-markedet for fire danske virksomheder.',
   'Demoprofil (testdata). Fokus på hvornår et nyt marked er en mulighed og hvornår det er en distraktion — og hvad det faktisk koster at finde ud af.', 6)
on conflict (id) do nothing;

insert into partner_profile_competence_tag (partner_profile_id, competence_tag_id)
select p.id, t.id
from (values
  ('d0000000-0000-4000-8000-000000000301'::uuid, 'prissaetning-og-pakker'),
  ('d0000000-0000-4000-8000-000000000301'::uuid, 'salg-og-marketing'),
  ('d0000000-0000-4000-8000-000000000301'::uuid, 'skalering-funding-og-exit'),
  ('d0000000-0000-4000-8000-000000000302'::uuid, 'oekonomi-og-noegletal'),
  ('d0000000-0000-4000-8000-000000000302'::uuid, 'skalering-funding-og-exit'),
  ('d0000000-0000-4000-8000-000000000303'::uuid, 'positionering-og-kommunikation'),
  ('d0000000-0000-4000-8000-000000000303'::uuid, 'salg-og-marketing'),
  ('d0000000-0000-4000-8000-000000000304'::uuid, 'tech-automatisering-og-ai'),
  ('d0000000-0000-4000-8000-000000000304'::uuid, 'oekonomi-og-noegletal'),
  ('d0000000-0000-4000-8000-000000000305'::uuid, 'fastholdelse-og-churn'),
  ('d0000000-0000-4000-8000-000000000305'::uuid, 'prissaetning-og-pakker'),
  ('d0000000-0000-4000-8000-000000000306'::uuid, 'udland-nye-markeder'),
  ('d0000000-0000-4000-8000-000000000306'::uuid, 'positionering-og-kommunikation')
) as m(partner_id, tag_slug)
join partner_profile p on p.id = m.partner_id
join competence_tag t on t.slug = m.tag_slug
on conflict do nothing;

commit;
