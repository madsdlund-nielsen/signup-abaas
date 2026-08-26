-- Fjern al demodata igen. Alle demorækker har uuid'er i d0000000-0000-4000-8000-…-serien,
-- så oprydningen rammer præcis dem og intet andet. Kør før rigtige data lægges ind.
--
--   npm run db:seed:demo:clean
--
-- Koblingstabellerne rydder sig selv via `on delete cascade`.

begin;

delete from quiz_question   where id::text like 'd0000000-0000-4000-8000-%';
delete from partner_profile where id::text like 'd0000000-0000-4000-8000-%';

commit;
