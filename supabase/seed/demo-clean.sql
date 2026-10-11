-- Fjern al demodata igen. Alle demorækker har uuid'er i d0000000-0000-4000-8000-…-serien,
-- så oprydningen rammer præcis dem og intet andet. Kør før rigtige data lægges ind.
--
--   npm run db:seed:demo:clean
--
-- Koblingstabellerne rydder sig selv via `on delete cascade`.

begin;

-- Den befolkede tilstand (ADR 0043) først: board cascader medlemskab, møder, deltagere, noter,
-- dagsorden, vurderinger og opkrævninger. Prisreglen bagefter — payment_charge → pricing_rule
-- cascader IKKE, så den kan først slettes når opkrævningerne er væk. Har rigtige møder nået at
-- få opkrævninger på demo-reglen, fejler sletningen højlydt frem for at efterlade forældreløse
-- rækker. Ejerens quiz-svar cascader fra quiz_option-sletningen nedenfor.
delete from board        where id::text like 'd0000000-0000-4000-8000-%';
delete from pricing_rule where id::text like 'd0000000-0000-4000-8000-%';
delete from fee_rule     where id::text like 'd0000000-0000-4000-8000-%';

delete from quiz_question   where id::text like 'd0000000-0000-4000-8000-%';
delete from partner_profile where id::text like 'd0000000-0000-4000-8000-%';

-- Notifikationsskabeloner (fase 4.6, ADR 0057). En publiceret version kan normalt ikke slettes
-- (append-only-trigger i 0021); vagten undtager demo-id-navnerummet, så oprydningen kræver
-- hverken tabelejeren eller DDL. Udsendelser der brugte en demoskabelon er selv demodata og går
-- med (template_id har ingen cascade).
delete from notification_delivery where template_id::text like 'd0000000-0000-4000-8000-%';
delete from notification_template where id::text like 'd0000000-0000-4000-8000-%';

commit;
