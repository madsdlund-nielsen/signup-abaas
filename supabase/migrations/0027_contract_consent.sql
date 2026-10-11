-- Samtykke er en del af kontrakten — SMS-opt-in fjernes (ADR 0065).
--
-- Beslutning (Mads, 2026-10-11): "Alle samtykker ift GDPR, ai og hvad vi ellers har hængende er
-- en del af kontrakt indgåelsen. Der skal ikke være yderligere levers på platformen til at opt
-- in eller out." SMS-samtykket fra 0024 (ADR 0061) var netop sådan et håndtag: en afkrydsning på
-- `/konto` med tidspunkt og en check-constraint der bandt det til nummeret.
--
-- Efter migrationen sendes SMS når brugeren har et telefonnummer (`phone_e164`, uændret);
-- uden nummer logges `fejlet: intet telefonnummer`. Nummeret, navnet og tidszonen bevares.
--
-- Forsigtigt og idempotent: constraint droppes før kolonnerne (den refererer til dem), og alt er
-- `if exists`, så migrationen kan køres igen. Data i de to kolonner går tabt med vilje — der er
-- ikke længere noget samtykke at dokumentere på kontoen; grundlaget er kontrakten.
--
-- Cookie-samtykket til analytics er IKKE berørt (bevidst undtagelse, ADR 0065): det gemmes ikke
-- i databasen og følger ikke af kontrakten.

alter table app_user drop constraint if exists app_user_sms_opt_in_consistent;

alter table app_user
  drop column if exists sms_opt_in,
  drop column if exists sms_opt_in_at;
