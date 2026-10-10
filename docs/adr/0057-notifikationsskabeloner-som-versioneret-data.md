# 0057 — Notifikationsskabeloner som versioneret data, motor med idempotensnøgle, og en log uden persondata

- **Status:** Accepteret
- **Dato:** 2026-10-10
- **Fase:** 4 (4.5 + 4.6)
- **Berører uafklaret punkt:** ja — udsendelsestidspunkter for påmindelse og ratinganmodning
  (afledt af ændre-/aflyse-vinduet, byggespec §12 pkt. 4), skabelonteksten (forudsætter
  ToS/samtykke), telefonnumre (hvor indsamles de, og med hvilket samtykke), og om ejeren også
  skal have en bekræftelse ved aflysning. Ingen af dem er besluttet her.

## Kontekst

ADR 0048 byggede notifikationsoversigten skærm-først med kataloget i kode og lovede at
skabelonerne fik en tabel, når 4.6 blev bygget. Det er nu. `docs/fase-4.md` stiller tre krav
der alle rører datamodellen: *skabeloner som data, ikke kode* (4.5), *live preview* og
*synlig markering af hvad der er live* (4.6, begge eksplicitte). Dertil skal motoren sende,
retry'e og fejlrapportere uden at kunne sende den samme besked to gange og uden at logge
persondata.

Valgene er Spand A (datamodel, RLS-mønster, mappestruktur) og berører stub-politikken (ingen
opfundet tekst).

## Overvejede muligheder

**Skabelon-datamodel**
- *A — én række pr. (type, kanal) der redigeres på stedet.* Enkelt, men en udsendt besked kan
  ikke føres tilbage til den tekst den havde, og der er ingen skillelinje mellem «jeg skriver»
  og «det er i produktion» — netop det 4.6 forbyder at være i tvivl om.
- *B — versioner med `status` (`udkast`/`live`/`arkiveret`), samme greb som `pricing_rule`.*
  Udkast og live er adskilte rækker; publicering gør udkastet live og arkiverer den forrige.
- *C — to kolonnesæt (`draft_*`, `live_*`) på én række.* Ingen historik.

**Hvor kataloget bor** (ADR 0048 sagde at det «flytter med»)
- *A — flyt kataloget ind i tabellen.* Så kunne en række i en tabel love en besked ingen kode
  sender, og de tilladte variabler pr. type ville stå i data, løsrevet fra den kode der leverer dem.
- *B — kataloget bliver i kode; tabellen holder kun teksten, nøglet på `type_key`.*

**Idempotens**
- *A — log efter afsendelse.* To overlappende kørsler kan begge sende, før den ene logger.
- *B — reservér først:* indsæt logrækken med en unik nøgle FØR noget sendes.

## Beslutning

**1. Skabeloner er versioneret data (B).** `notification_template` (migration 0021): én række pr.
version af en (`type_key`, `channel`). Højst én `live` og højst ét `udkast` pr. par — to
partielle unikke indekser, samme greb som `pricing_rule_one_active`; constrainten er
mekanismen. *Publicér* gør udkastet live og arkiverer den forrige live **i samme transaktion**
(`publish_notification_template`, en SECURITY INVOKER-funktion kun service-role må kalde):
to separate kald fra appen ville, hvis det andet fejlede, efterlade et par helt uden live
skabelon, og dermed uden udsendelse. En trigger gør indholdet af en live/arkiveret version
uforanderligt og forbyder at slette dem — en sendt besked kan altid føres tilbage til
`template_id`. Tabellen **starter tom**; ingen tekst i migrationen, koden eller testseed'et.
Demo-seed'et (ADR 0043) indsætter åbenlyst falske `[DEMO]`-skabeloner, skrevet mod kataloget og
kun hvor ingen skabelon findes; `demo-clean` slår triggeren fra for netop den oprydning.

**2. Kataloget bliver i kode (B) — ADR 0048 opdateres.** `NOTIFICATION_TYPES` er bundet til de
udløsere og de variabler koden leverer; en tabel ville give en anden sandhedskilde. Kataloget
får to nye felter: `variables` (de tilladte flettevariabler pr. type) og `schedule` (den
maskinlæsbare modpart til `timing`, `null` indtil ejeren beslutter). Eksempelværdier til
previewet bor i `examples.ts`, alle `[DEMO]`/`.invalid`.

**3. Flettesyntaksen er lille og eksplicit.** `{{navn}}` (små bogstaver, tal, understreg),
ingen betingelser eller udtryk. `renderTemplate` er ren og bruges både af motoren og af
editorens preview, så de to aldrig kan betyde forskellige ting. Regler: en ukendt variabel,
en variabel uden værdi og en ugyldig `{{ }}` er *problemer* — aldrig et stille tomt felt; et
resultat med problemer er `ok: false` og sendes ikke. Værdier escapes i HTML-delen (og selve
skabelonteksten behandles som tekst, ikke HTML); linjeskift i værdier fjernes fra emnelinjen;
en værdi fortolkes aldrig igen. Der er bevidst ingen modtagernavn-variabel: ejere har ikke et
navn i datamodellen.

**4. Editoren markerer live vs. udkast to gange.** Et guldfyldt versal-mærke `LIVE · v3` og
en kontur-mærke `UDKAST · v4` i hver kanals overskrift (teksten gentager altid tilstanden;
farven forstærker kun), en advarsel så længe det gemte udkast afviger fra live, en markering af
ugemte ændringer, og publicering som et to-trins valg («Publicér…» → «Bekræft: gør live»).
Oversigten viser pr. type og kanal om der er en live skabelon. Ukendte variabler markeres i
previewet og spærrer «Publicér».

**5. Motoren reserverer før den sender (B).** `notification_delivery.idempotency_key` er unik:
`type:objekt:modtager:kanal[:diskriminator]`. Rækken indsættes med status `afventer` FØR
afsendelsen, så to samtidige kørsler aldrig begge sender. Diskriminatoren skelner lovlige
gentagelser (en ny flytning af samme møde; en påmindelse for en ny mødetid). Rækkefølge:
reservér → find live skabelon → render → slå adressen op → send med op til 3 forsøg og
eksponentiel backoff (kun for forbigående fejl; en 4xx er endelig) → log → rapportér endelige
fejl til analytics-porten. Ingen live skabelon logges som `fejlet: ingen live skabelon`; motoren
har ingen tekst at falde tilbage på.

Hvornår en række kan *tages op igen* følger ét princip: **kun en række der aldrig nåede ud på
ledningen** (`fejlet` eller et forladt `afventer`, begge med 0 forsøg). Forsøgstælleren skrives
FØR hvert kald, så en række med forsøg > 0 aldrig overtages bagefter — hellere en tabt besked
end en dobbelt. Dermed heler «ingen live skabelon» sig selv, når en skabelon publiceres, mens en
transportfejl er endelig og synlig i loggen. En stub-/demo-udsendelse er endelig: nøglen er
brugt, og intet gensendes bagud når leverandøren senere tændes.

**6. Loggen indeholder ingen persondata.** Modtageren er `recipient_user_id`; der er ingen
kolonne til e-mail eller telefon (testet). Adressen slås op server-side i det øjeblik der
sendes og gemmes ingen steder. Fejltekster skrubbes for e-mailadresser og telefonnumre før de
skrives til loggen eller sendes til analytics, fordi leverandørfejl citerer modtageren. Rækken
følger brugeren ved sletning (`on delete cascade`).

**7. Adaptere.** Resend (`POST /emails`, Bearer, `{from,to,subject,text,html}`,
`Idempotency-Key`) og inMobile bag de eksisterende porte; portene returnerer nu en kvittering
(`{ reference }`) i stedet for `void`, og leverandørfejl kastes som `ProviderError` med
`retryable`. Vælgelsen følger ADR 0041: rigtig nøgle + flag vinder, ellers `FLAG_DEMO` →
demo (logger `[DEMO]`, kvitterer `DEMO-MSG-…`, logger hverken adresse eller tekst), ellers stub.
Resends EU-region vælges på **afsenderdomænet** (`eu-west-1`, Irland/Dublin) i Resend-UI'et,
ikke i API-kaldet. **inMobile-adapteren er bygget mod bedste forståelse af API v4 og aldrig
kørt mod en konto** — endpoint, auth og feltnavne er markeret `TODO(mads)` og skal verificeres
live, før `FLAG_SMS` tændes.

**8. Kobling og planlægning.** Aflysning/flytning i `src/server/meetings/actions.ts` sender til
boardets partnere via `after()` — efter svaret, og en fejl i notifikationen kan aldrig fejle
handlingen (den logges skrubbet). `sendMeetingReminders(now)` og `sendRatingRequests(now)` er
rene «find de skyldige + send»-funktioner, men svarer `ikke-fastlagt` og sender intet, så længe
katalogets `schedule` er `null` — og det er den, til ejeren beslutter. En beskyttet rute
(`POST /api/cron/notifications`, `x-cron-secret`/`CRON_SECRET` som betalingsskivens
`charge-periods`: 503 uden secret, 401 ved forkert, konstant-tids sammenligning) findes, men er
**ikke planlagt** — ingen scheduled function. «Fejlet betaling» har sin afsendelsesfunktion
(`notifyPaymentFailed`); koblingen på det fejlede træk ejes af betalingsskiven
(`src/server/charges/`, B-19) og er ikke rørt her.

## Konsekvenser

- Positive: admin kan skrive, previewe og publicere skabeloner uden en deploy, og aldrig være i
  tvivl om hvad der er i produktion. En udsendt besked kan føres tilbage til den eksakte version.
  Motoren kan ikke sende to gange eller opfinde en tekst. Intet nyt feature-flag (kanalerne har
  allerede `FLAG_EMAIL`/`FLAG_SMS`).
- Negative / pris: kataloget og kodens udløsere skal holdes i sync manuelt (en test vogter at
  variablerne og tidsplanen hænger sammen, og at demo-skabelonerne er gyldige mod kataloget).
  `publish_notification_template` er endnu en funktion i `public` (revoked fra
  anon/authenticated, jf. ADR 0047). SMS kan ikke sendes: **telefonnumre findes ikke i
  datamodellen** (`app_user` har kun e-mail), så enhver SMS logges `fejlet: intet
  telefonnummer`. Ændringer lavet direkte i Cal.com (webhook) udløser endnu ingen besked.
- Opfølgning:
  - TODO(ejer): udsendelsestidspunkt (`timing` + `schedule`) for påmindelse og ratinganmodning,
    og derefter planlægning af ruten (Netlify scheduled function).
  - TODO(ejer): skabelonteksten — forudsætter ToS/samtykke. TODO(ejer): skal ejeren også have en
    bekræftelse ved aflysning/flytning (i dag kun partnerne)?
  - TODO(ejer): telefonnumre — hvor indsamles de, og med hvilket samtykke.
  - TODO(mads): verificér inMobile-adapteren live; bekræft Resend-domænets region (`eu-west-1`).
  - ~~Kobl `notifyPaymentFailed` på det fejlede træk~~ → koblet i Alunta-webhookens `invoice.payment_failed` (B-41, 2026-10-10).
  - Backlog B-40: Cal.com-webhookens aflysning/flytning sender ingen besked.
  - Signerede engangslinks til rating (B-21) er stadig ikke bygget; ratinganmodningen linker
    til `/moeder/[id]`, hvor ejeren er logget ind.
