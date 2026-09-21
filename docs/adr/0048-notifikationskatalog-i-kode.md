# 0048 — Notifikationskataloget bor i kode indtil skabelonerne får en tabel

- **Status:** Accepteret
- **Dato:** 2026-09-21
- **Fase:** 4 (4.5/4.6)
- **Berører uafklaret punkt:** ja — udsendelsestidspunkter (afledt af §12 pkt. 4,
  ændre-/aflyse-vinduet) og skabelonteksten, der hænger sammen med ToS/samtykke

## Kontekst

Notifikationsoversigten er den første skive i fase 4.5/4.6 og bygges skærm-først
(ADR 0042): skærmen mod demo-/stub-tilstand først, leverandøren bagefter. Skærmen skal
vise to ting — hvilke beskeder platformen skylder at sende, og hvor langt hver kanal er
fra at kunne sende dem.

`docs/fase-4.md` §4.5 stiller kravet **"skabeloner som data, ikke kode"**. Taget bogstaveligt
ville det betyde at intet om notifikationer må stå i kode før der findes en tabel — og så
kan skærmen ikke bygges først, hvilket er præcis det loop ADR 0042 vendte om.

Samtidig er der to slags oplysninger i spil, og de har vidt forskellig levetid:

- **Kataloget** — at der findes fire beskedtyper (mødepåmindelse, aflysning/flytning,
  ratinganmodning, fejlet betaling), hvem de går til, og hvad der udløser dem. Det er
  fase 4's DoD, ikke et redaktionelt valg. Det ændrer sig kun hvis kravet ændrer sig.
- **Skabelonen** — emnelinje og brødtekst. Den skal kunne redigeres af admin med live
  preview (§4.6), ændrer sig løbende, og er ikke skrevet endnu. Den hænger desuden sammen
  med ToS og samtykketekst, som er ejerens punkter.

## Overvejede muligheder

- **A — vent med skærmen til tabellen findes.** Tro mod §4.5's ordlyd. Men den udskyder
  hele skiven bag en migration og en admin-editor, og Mads får intet at klikke på i
  mellemtiden. Det er det gamle loop ADR 0042 afskaffede.
- **B — læg både katalog og skabelontekst i kode nu.** Hurtigst, men skriver netop det
  der skal være data ind i kode, og inviterer til at en "midlertidig" emnelinje overlever
  til produktion. Bryder desuden stub-politikken: en opfundet skabelontekst er et
  plausibelt svar, ikke et synligt hul.
- **C — katalog i kode, skabeloner slet ikke.** Skærmen viser strukturen og de faktiske
  huller; skabelontekst findes hverken i kode eller database, og skærmen siger det højt.

## Beslutning

**C.** `NOTIFICATION_TYPES` i `src/server/notifications/` holder kataloget som en
`readonly`-konstant afledt direkte af fase 4's DoD. Skabelontekst skrives ikke — hverken
i kode eller som placeholder — og skærmen oplyser at den mangler. Når 4.6 giver
skabelonerne deres tabel, flytter kataloget med som nøgler i den tabel; skærmens signatur
ændrer sig ikke, kun kilden. Samme greb som fase 4.4's opsummering.

To afledte valg i samme skive:

1. **Kanaltilstanden spørges hos adapteren** (`createEmailSender(env).name`), ikke ved at
   læse `RESEND_*`/`INMOBILE_*` en gang til. Nøglenavnene bor i `src/lib/<vendor>/`, og
   en oversigtsskærm der har sin egen mening om hvad der er konfigureret, kan komme til at
   lyve efter et adapter-skift. Skærmen skelner dog mellem "flaget er slukket" og "flaget er
   tændt, men nøglerne mangler", fordi de to huller lukkes forskelligt.
2. **Intet nyt feature-flag.** Skiven sender ikke og ændrer ikke tilstand; den læser.
   Et `FLAG_NOTIFICATIONS` ville være et flag-design-valg (Spand A) uden et modul at skjule.
   `/admin/vurderinger` er samme slags passive admin-flade og har heller intet flag.

## Konsekvenser

- Positive: skiven kan klikkes på sua-abaas.netlify.app nu, uden konto, migration eller
  editor. Skærmen er produktionskode fra første commit — kun datakilden skifter senere.
  Admin kan se præcis hvad der mangler pr. kanal frem for at gætte.
- Negative / pris: kataloget står to steder når tabellen kommer (kode + migration), indtil
  4.6 flytter det. Det er bevidst midlertidigt og står i `docs/fase-4.md`.
- Opfølgning:
  - TODO(ejer): udsendelsestidspunkt for mødepåmindelse og ratinganmodning. Påmindelsen
    hænger sammen med ændre-/aflyse-vinduet (§12 pkt. 4) — en påmindelse der lander efter
    fristen for at flytte, er værdiløs. Registreret i `docs/stub-register.md`.
  - TODO(ejer): skabelontekst, som forudsætter ToS/samtykke.
  - 4.6 bygger redigering med live preview + synlig markering af hvad der er live, og
    flytter kataloget til tabellen.
  - Udsendelseslog og retry/fejllogning via PostHog (§4.5) findes ikke endnu; skærmen
    påstår ikke at have dem.
