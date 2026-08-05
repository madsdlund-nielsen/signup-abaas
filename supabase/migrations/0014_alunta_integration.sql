-- Fase 3 — Alunta-integration (ADR 0030, dataflow-afsøgningen kørt mod verificeret OpenAPI-spec).
-- Alunta har INTET synkront kort-træk: forbruget indberettes som usage-events, og Alunta
-- fakturerer/trækker automatisk pr. periode. Deraf to udvidelser:

-- 'rapporteret' = usage-eventet er sendt til Alunta og indgår i næste periodefaktura.
-- Livscyklus: afventer → rapporteret → gennemfoert/fejlet (webhook er autoritativ for de sidste).
-- Tilføjes uden brug i samme transaktion (PG-krav ved ALTER TYPE ADD VALUE).
alter type payment_charge_status add value if not exists 'rapporteret' after 'afventer';

-- invoice.paid-webhookens kobling: Aluntas faktura dækker PERIODENS samlede forbrug, så
-- referencen sættes på alle rapporterede charges fakturaen afregner. provider_charge_ref
-- bærer usage-event-referencen (idempotency-svar); denne bærer fakturaens uuid.
alter table payment_charge add column provider_invoice_ref text;
