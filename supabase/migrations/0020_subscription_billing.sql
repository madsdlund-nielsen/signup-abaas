-- Fase 3 / backlog B-19 — fra "træk pr. afholdt møde" til "fast abonnement hver 4. uge"
-- (ADR 0034 = beslutningen, ADR 0056 = kodens rework). Naming: ADR 0006 (ental, snake_case).
-- RLS: uændret (ADR 0007) — payment_charge-policies hænger på membership_id, som ikke ændres;
-- ingen nye tabeller, ingen nye write-policies (writes går via service-role bag rolle-/ejerskabstjek).
--
-- IKKE-DESTRUKTIV (produktionsdata kan findes): intet droppes. `meeting_id` gøres nullable i
-- stedet for at fjernes, og dens unique-constraint bliver stående — gamle pr.-møde-rækker
-- bevarer deres idempotens, nye periode-rækker har meeting_id = null og er unikke på perioden.
--
-- INGEN TAL: beløb beregnes stadig af den aktive pricing_rule (formlen er uændret:
-- (base + n × per_partner) × frekvensfaktor). Intet beløb, ingen sats og ingen frist lever her.

-- --- membership: hvornår løber perioderne fra, og hvornår holdt de op? ---

-- billing_anchor = datoen (Europe/Copenhagen) hvor kortet blev registreret, dvs. hvor
-- abonnementet kan begynde at trække. Null indtil da (intet at fakturere uden kort). Sættes
-- ÉN gang og flyttes aldrig (webhooken/demo-bekræftelsen rører den kun mens den er null) —
-- ellers ville perioderne forskubbes og unique-constrainten under miste sin mening.
alter table membership add column billing_anchor date;

-- cancelled_at = datoen abonnementet blev opsagt. Perioder der starter EFTER den oprettes ikke.
-- TODO(ejer): opsigelsesvarsel — hvor længe løber det betalte abonnement efter opsigelsen?
-- Indtil det er besluttet er opsigelsesdatoen ren afskæring af NYE perioder (ingen refusion).
alter table membership add column cancelled_at date;

-- Leverandørens abonnement (Alunta subscription-uuid, kommer med checkout.completed). Hvert
-- medlemskab har ét abonnement hos leverandøren; prisen opdateres på det i stedet for at
-- indberette forbrug. Separat fra provider_customer_ref (kunden).
alter table membership add column provider_subscription_ref text;

-- Tilbagefyld for eksisterende rækker, så de ikke står uden periodeanker/opsigelsesdato.
-- created_at er det bedste vi har for "registreret" på gamle rækker (updated_at flytter ved
-- hver frekvensændring). Berører kun rækker der allerede har kort / er opsagt.
update membership
   set billing_anchor = (created_at at time zone 'Europe/Copenhagen')::date
 where card_status = 'registreret' and billing_anchor is null;

update membership
   set cancelled_at = (updated_at at time zone 'Europe/Copenhagen')::date
 where status = 'opsagt' and cancelled_at is null;

-- --- payment_charge: én række pr. medlemskab pr. periode (28 dage) ---

-- Perioden er halvåben: [period_start, period_end). period_end = næste periodes start.
-- frequency_weeks/partner_count er øjebliksbilledet beløbet blev beregnet ud fra PÅ PERIODENS
-- START (audit sammen med pricing_rule_id): hvorfor kostede perioden det den gjorde, uden at
-- skulle rekonstruere boardets sammensætning bagud. Null på gamle pr.-møde-rækker.
alter table payment_charge alter column meeting_id drop not null;

alter table payment_charge
  add column period_start date,
  add column period_end date,
  add column frequency_weeks int,
  add column partner_count int;

alter table payment_charge
  add constraint payment_charge_period_pair
    check ((period_start is null) = (period_end is null)),
  add constraint payment_charge_period_order
    check (period_end is null or period_end > period_start),
  -- En række handler enten om et møde (gammel model) eller om en periode (ny model).
  add constraint payment_charge_subject
    check (meeting_id is not null or period_start is not null),
  add constraint payment_charge_frequency_check
    check (frequency_weeks is null or frequency_weeks in (4, 8, 12)),
  add constraint payment_charge_partner_count_check
    check (partner_count is null or partner_count >= 1),
  -- IDEMPOTENS for kørslen: samme medlemskab kan ikke få to opkrævninger for samme periode.
  -- Constrainten ER mekanismen (som webhook-idempotens, ADR 0027/0029). Gamle rækker har
  -- period_start = null, og null er forskellig fra null i en unique-constraint, så de kolliderer ikke.
  add constraint payment_charge_membership_period_unique
    unique (membership_id, period_start);
