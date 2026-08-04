# 0027 — Webhook-ingest: signatur før alt, idempotens via event-tabel

- **Status:** Accepteret
- **Dato:** 2026-08-04
- **Fase:** 2
- **Berører uafklaret punkt:** nej (teknisk mønster; genbruges af Alunta-webhooks i fase 3)

## Kontekst

Cal.com-webhooks (`BOOKING_CREATED/RESCHEDULED/CANCELLED`) skal opdatere `meeting` i
Supabase — idempotent og signaturverificeret (byggespec §5.4). Det er **repoets første
route handler overhovedet**: `src/app/api/` fandtes ikke, alt har været server actions.
Mønstret her bliver derfor konventionen for kommende webhooks (Alunta i fase 3), og et
API-endpoint-mønster er et Spand A-valg.

Stub-politikken sætter to hårde grænser: **signaturverifikation og idempotens må aldrig
stubbes.**

## Overvejede muligheder

- **Idempotens:** dedikeret event-tabel med unique-constraint vs. "upsert og håb" vs.
  in-memory dedup (dør ved genstart/multi-instans — Netlify-funktioner er flygtige).
- **Manglende konfiguration:** 503 (afvis alt) vs. fail-open (behandl uverificeret).
- **Ukendt booking-uid:** opret mødet fra webhooken vs. log + ignorér.
- **Kerne-placering:** logik direkte i route-filen vs. ren, testbar kerne + tynd route.

## Beslutning

Endpoint: `src/app/api/webhooks/calcom/route.ts` (Node-runtime → `node:crypto`).
Kernen er ren og HTTP-/DB-fri i `src/server/meetings/webhook.ts` (signatur, event-id,
parse, mapping) — unit-testbar uden route.

Rækkefølgen i handleren er bærende og genbruges for fremtidige webhooks:

1. **Rå body læses før parse** — signaturen (HMAC-SHA256, `x-cal-signature-256`) dækker
   rå bytes. Konstant-tids-sammenligning.
2. **Manglende secret/Supabase → 503, aldrig fail-open.** Hellere en død webhook end en
   åben. Ugyldig/manglende signatur → 401.
3. **Idempotensrækken skrives FØR mutationen.** `meeting_webhook_event` (0012) med
   `unique (provider, provider_event_id)`; unique-kollision (23505) → 200 "allerede
   behandlet" uden ny mutation. Constrainten ER mekanismen — race-sikker, overlever
   genstart og parallelle leverancer. Tabellen er samtidig audit-spor for webhook-drevne
   ændringer. Cal.com sender intet stabilt event-id, så nøglen afledes deterministisk:
   `trigger:uid:createdAt` — en genleverance kolliderer, en ny hændelse gør ikke.
4. **Mutation via `provider_booking_uid`.** `RESCHEDULED` matcher den gamle uid
   (`rescheduleUid`) og skriver den nye. **Ukendt uid → logget + ignoreret**: webhooks
   opretter aldrig møder — Supabase er sandhedskilde, og appen opretter (arkitekturprincip
   1; §5.4's "webhooks opdaterer meetings"). `CANCELLED` sætter kun `status='aflyst'` —
   registreringer og noter røres aldrig af en webhook.
5. **Fejl → `Analytics.captureException`** med kontekst (kilde, step, trigger, uid);
   stubben kaster ikke, så logning er ubetinget sikker. Verificeret-men-ukendt event-form
   kvitteres 200, så Cal.com ikke genleverer for evigt.

Env: `CALCOM_WEBHOOK_SECRET` (server-only, Netlify env vars — ADR 0008/0012).

## Konsekvenser

- **Positive:** dobbelt leverance kan aldrig dobbelt-mutere (DB-garanti, ikke
  applikationshåb); uverificeret trafik rører aldrig data; kernen er fuldt unit-testet
  (signatur/nøgle/parse/mapping) uden HTTP eller DB; fase 3 arver et færdigt mønster.
- **Negative / pris:** event-tabellen vokser (afgrænset: én række pr. leverance; oprydning
  kan tilføjes senere); det afledte event-id afhænger af at Cal.com genleverer med samme
  `createdAt` — liveverifikationen bekræfter leveranceformatet sammen med resten af
  Cal.com-antagelserne.
- **Opfølgning:** Alunta-webhooks (fase 3) følger samme rækkefølge med egen event-tabel
  eller `provider`-kolonnen her; liveverifikation af payload-form når Cal.com-nøglerne lander.
