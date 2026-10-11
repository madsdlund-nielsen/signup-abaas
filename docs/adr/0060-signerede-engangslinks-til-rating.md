# 0060 — Signerede engangslinks til rating: HMAC over rækken, engangsbrug afgjort i databasen, ingen orakel

- **Status:** Accepteret
- **Dato:** 2026-10-11
- **Fase:** 4 (4.2 + 4.5; lukker B-21)
- **Berører uafklaret punkt:** ja — *linkets levetid* (ejer). Den tekniske default er ikke et
  forretningstal, men er markeret `TODO(ejer): linkets levetid` og registreret.

## Kontekst

Fase 4.2's DoD og byggespec §8 kræver at en vurdering kan **besvares på under et minut fra en
mail**, uden «åbne endpoints». ADR 0038 udskød linkene med den begrundelse at et engangslink er
en **auth-fri skrivevej**, der først kan gennemspilles end-to-end når en notifikationsmotor
udsender det. Motoren findes nu (ADR 0057: `sendRatingRequests`, katalogvariablen `link`,
idempotensnøgle), så udskydelsen er ikke længere en grund. Til gengæld er sikkerheden hele
opgaven: det her er den eneste skrivevej i systemet uden session.

Valgene er Spand A (datamodel, RLS-mønster, secrets-struktur) og berører en kant mod adgangsporten
(ADR 0020).

## Overvejede muligheder

**Hvad bærer autorisationen**
- *A — et tilfældigt token gemt i en tabel (slå op, tjek).* Enkelt, men tokenet ER hemmeligheden:
  en læk af tabellen (backup, log, SQL-injection i en anden feature) giver gyldige links.
- *B — en ren signatur uden række (HMAC over mødet + modtager + udløb i URL'en).* Ingen tabel,
  men så kan «brugt» ikke registreres, URL'en bærer persondata/møde-id, og engangsbrug er umulig.
- *C — række + HMAC over rækkens indhold; URL'en bærer kun et opaque id og signaturen.*
  Tabellen indeholder ingen hemmelighed (tokenet genskabes af id + `RATING_LINK_SECRET`), «brugt»
  er en kolonne, og signaturen binder linket til præcis dét møde/den rater/udløbstid rækken har.

**Hvor engangsbrugen håndhæves**
- *A — i koden:* læs rækken, tjek `used_at`, skriv ratingen, sæt `used_at`. Race: to samtidige
  kald kan begge læse «ubrugt». Kun unik-constraint på ratingen er sidste værn, og den
  *opdaterer* (upsert) — den ville lade begge «lykkes».
- *B — i databasen:* én `security invoker`-funktion med et betinget `UPDATE … WHERE used_at is
  null and expires_at > now() RETURNING`, og rating-INSERT i samme transaktion.

**Adgangsporten (ADR 0020)**
- *A — lad `/vurdering/*` ligge bag den delte adgangskode.* Modtageren af en mail har aldrig
  tastet den; linket ville aldrig virke, så længe porten er slået til.
- *B — undtag præcis én rute.*

## Beslutning

**1. Tokenet er `<id>.<signatur>` (C).** `id` er `rating_link.id` (UUID v4, 122 tilfældige bit) uden
bindestreger; `signatur` er hex af HMAC-SHA256 med `RATING_LINK_SECRET` over
`rating-link-v1|id|meeting_id|user:<id> eller partner:<id>|expires_at(ISO)`. Verifikation slår
rækken op på id'et, **genberegner** signaturen fra rækkens aktuelle indhold og sammenligner i
konstant tid (`timingSafeEqual`; samme mønster som gate-cookien, men `node:crypto` fordi dette
kun kører på serveren). URL'en indeholder dermed intet møde-id og ingen persondata, og et
manipuleret token — eller en række der er ændret efter udstedelsen — afvises.
*Entropi:* at gætte et token kræver at forfalske HMAC'en, dvs. kende hemmeligheden (2^256);
id'ets 122 bit er kun opslagsnøgle og gør ikke noget alene. Der er derfor **ingen rate-limit** (der
er ingen infrastruktur til det på Netlify uden en ekstern tjeneste), og den er heller ikke nødvendig:
hvert gæt har samme ubetydelige chance, og et forkert gæt skriver intet.

**2. Fail-closed uden hemmelighed.** `RATING_LINK_SECRET` mangler eller er under 32 tegn →
funktionen er slået fra: intet link udstedes, intet kan indløses, siden svarer «ugyldigt». Der er
aldrig en usigneret vej og ingen demo-genvej (autorisation stubbes ikke, ADR 0041). Ratinganmodningen
falder da tilbage til det eksisterende loginbeskyttede link til `/moeder/[id]`.

**3. Engangsbrug i databasen (B).** Migration `0023_rating_link.sql`: tabellen `rating_link`
(`id`, `meeting_id`, `rater_user_id` | `rater_partner_profile_id` — præcis én, spejler
`meeting_rating` —, `expires_at`, `used_at`, `created_at`), unik pr. (møde, rater). Funktionen
`redeem_rating_link(link_id, score, comment)` gør i **én transaktion**: betinget UPDATE
(`used_at is null and expires_at > now()`, mødet stadig `afholdt`, raten stadig ejer/deltager —
0015-reglerne genprøves) → INSERT i `meeting_rating` (samme upsert som den indloggede vurdering).
To samtidige kald låser samme række; det andet genvurderer WHERE efter commit og rammer ingen
række → `null`. Fejler INSERT (fx ugyldig score), rulles `used_at` tilbage: et link brændes aldrig
uden at have gemt en vurdering. Testet med rigtige samtidige forbindelser (`tests/db`). Funktionen er
revoked fra `public`/`anon`/`authenticated` (ADR 0047-mønstret), så den ikke kan nås via
`/rest/v1/rpc` — kun service-role bag signaturtjekket.
*RLS:* kun admin læser; ingen policy for ejer/partner/anon — linket bæres af signaturen, ikke en
session — og ingen write-policies.

**4. Ingen orakel.** Ukendt id, forfalsket signatur, forkert format, ikke-afholdt møde og «funktionen
er slået fra» giver **samme udfald og samme tekst** («Linket kan ikke bruges»); opslaget af et ukendt
id udfører samme HMAC-arbejde som et kendt. Først når signaturen er bevist gyldig — modtageren har
beviseligt fået linket — skelnes der mellem «brugt» («Tak») og «udløbet» (henvisning til login).

**5. Siden `/vurdering/[token]`.** Validerer server-side, viser møde-tidspunkt og boardnavn,
samme 1-5-skala og valgfri kommentar som den indloggede formular (`AuthForm`/`Select`/`TextArea`).
**Indløsningen sker kun i en server action (POST)**, aldrig ved at åbne siden — en mailscanner eller
link-preview, der henter linket, må ikke brænde det. En ugyldig score eller for lang kommentar
(2000 tegn, teknisk værn) afvises *før* indløsningen, så linket ikke brændes af en tastefejl. Siden
er `noindex` og sender `Referrer-Policy: no-referrer`. Vurderingen gælder **mødet som helhed**;
vurdering af den enkelte rådgiver kræver et valg pr. rådgiver og bliver på den indloggede flade.

**6. Adgangsporten undtager præcis én rute.** `isGateExempt` (`/gate` og præfikset `/vurdering/`,
med afsluttende skråstreg så `/vurderingfoo` ikke slipper igennem) bruges af proxyen. Hver ny
undtagelse er en bevidst åbning af en auth-fri vej og kræver en ADR.

**7. Kobling til motoren.** `sendRatingRequests` udsteder (find-eller-opret, idempotent) et link pr.
modtager — ejeren som bruger, en partner som sin katalogpost — og leverer det som `{{link}}`
(variablen findes allerede i kataloget; labelen er præciseret). Samme link bruges til e-mail og SMS.
Kan et link ikke udstedes (ingen hemmelighed, ingen app-URL, modtageren kan ikke knyttes, base-fejl)
falder `link` tilbage til loginlinket; en fejl fejler aldrig udsendelsen. Udsendelsestidspunktet er
stadig `null` (TODO(ejer)), så **intet sendes automatisk** — koblingen er bygget og testet, ikke tændt.

**8. Levetid.** `RATING_LINK_TTL_DAYS = 14` er en *teknisk* default, så et glemt link i en gammel
mail ikke virker for evigt. Basen har bevidst ingen default på `expires_at`. Hvor længe ejerne skal
have til at svare er ejerens beslutning: `TODO(ejer): linkets levetid`.

## Konsekvenser

- Positive: «ingen åbne endpoints» og «under et minut fra en mail» er begge opfyldt. Engangsbrugen
  afhænger ikke af at koden er skrevet rigtigt under race. En læk af `rating_link` giver ingen
  gyldige links. B-21 er lukket; fase 4.2's DoD er fuldt opfyldt.
- Negative / pris: ny secret (`RATING_LINK_SECRET`) der skal sættes i Netlify; roteres den, ugyldiggøres
  alle udestående links (acceptabelt — modtageren falder tilbage til login). Én rute er undtaget
  adgangsporten. Nogen der videresender mailen kan lade en anden vurdere på modtagerens vegne —
  inherent i et bearer-link; værnet er engangsbrug + levetid og at vurderinger er fortrolige datagrundlag
  uden automatisk konsekvens (ADR 0038). Tokenet står i klartekst i mailen (og i URL-linjen),
  men gemmes aldrig af os (ikke i `notification_delivery`, ikke i loggen).
- GDPR: ingen nye data ud over linkrækken (kun referencer til mødet og raten, som `meeting_rating`
  allerede holder). Rækken følger mødet og brugeren/partneren ved sletning (`on delete cascade`) og
  er ført ind i `docs/gdpr/sletteflow.md`. Ingen ny sub-processor.
- Opfølgning:
  - TODO(ejer): linkets levetid (teknisk default 14 dage).
  - TODO(ejer): udsendelsestidspunkt for ratinganmodningen (ADR 0057) — først da sendes linkene.
  - TODO(mads): sæt `RATING_LINK_SECRET` (≥ 32 tilfældige tegn) i Netlify; verificér ved første
    rigtige mail at tokenet overlever en evt. link-tracking hos Resend (hold click-tracking FRA for beskeder med
    `{{link}}`, ellers kan URL'en blive omskrevet).
