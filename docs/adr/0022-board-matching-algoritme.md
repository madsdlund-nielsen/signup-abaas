# 0022 — Board-matching: grådig set-cover med deterministisk tie-break

- **Status:** Accepteret
- **Dato:** 2026-08-03
- **Fase:** 1
- **Berører uafklaret punkt:** ja — tie-break-regler og infobarens prisvisning; begge flaget, ingen af dem besluttet her

## Kontekst

Byggespec §5.2 beskriver matchingen som *"et lille set-cover-problem"*: dæk ejerens ønskede
kompetence-tags med 2-3 partnere. §3/§5.6 lægger en hård sidebetingelse oveni: *"Altid minimum 1
intern partner på ethvert board (flag valideret ved board-oprettelse)."* `docs/fase-1.md` §1.5
tilføjer en "udskift"-knap og en infobar der forklarer hvorfor et match ændrede sig.

To ting i spec'en er **ikke** afklarede:

1. **Tie-break.** §5.2 er selv flaget: *"Reglerne for valg ved flere lige gode kandidater (rating?
   tilgængelighed?) bør fastlægges. Se §12, punkt om tie-break."* Henvisningen er dangling — §12's
   tabel har intet tie-break-punkt (numrene 3, 20 og 23 mangler), og CLAUDE.md nævner det ikke.
   Rating hører desuden til fase 4 og tilgængelighed til fase 5; ingen af dem findes som data endnu.
2. **Infobarens indhold.** §5.2 siger infobaren viser *"løbende pris"* og at (i)-ikonet viser
   *"præcist prisregnestykke"* — men startpris/meeting-fee er et uafklaret punkt i CLAUDE.md.
   `docs/fase-1.md` omdefinerer infobaren til at forklare hvorfor et match ændrede sig.

## Overvejede muligheder

- **Algoritme:** eksakt set-cover (brute force over puljen) vs. **grådig** vs. simpel scoring
  (flest matchende tags pr. partner, uden hensyn til overlap).
- **Intern-kravet:** vælg frit og byt bagefter ud hvis der mangler en intern, vs. **vælg den interne
  først** så kravet er opfyldt ved konstruktion.
- **Tie-break:** opfind en rangering (fx intern før ekstern, eller "flest tags i alt") vs. **en
  neutral, deterministisk rækkefølge** der åbenlyst er en pladsholder.

## Beslutning

**Grådig set-cover, intern først, neutral deterministisk tie-break.** Implementeret i
`src/server/matching/algorithm.ts` — bevidst uden Supabase-, env- eller React-afhængigheder, så
algoritmen kan unit-testes uden database.

1. Vælg først den **interne** kandidat der dækker flest af ejerens ønskede tags. Kravet om mindst 1
   intern er dermed opfyldt ved konstruktion frem for ved en efterfølgende ombytning — færre
   kanttilfælde, og resultatet er lettere at forklare for en bruger.
2. Tilføj grådigt den kandidat der dækker flest **endnu udækkede** ønskede tags, indtil alt er dækket
   eller boardet rammer 3.
3. Top op til 2, hvis dækningen blev nået med én partner — et board på én partner er ikke et board.

Set-cover er NP-hårdt; grådig er standardtilnærmelsen og mere end god nok til en pulje i denne
størrelsesorden. Eksakt søgning ville være mulig, men optimaliteten er illusorisk så længe
tie-break-reglen er uafklaret: der findes ikke ét "rigtigt" board at ramme endnu.

**Tie-break (midlertidig):** `sort_order`, derefter navn, derefter id. Bevidst *neutral* — den
udtrykker ingen holdning til rating eller tilgængelighed og kan udskiftes uden at røre algoritmens
struktur. Det vigtige nu er determinisme: et match må ikke ændre sig mellem to kørsler.
`TODO(ejer): tie-break-regler ved lige gode kandidater`.

**Infobaren** viser **kompetence-delta** — hvilke af ejerens ønskede tags der udgår og tilkommer ved
en udskiftning (`computeSwapDelta`). `docs/fase-1.md` er styrende jf. CLAUDE.md, og prisvarianten
kan ikke bygges før startpris/meeting-fee er fastlagt. `TODO(ejer): startpris/meeting-fee`.

**Ikke bygget:** §5.2's krav om at udskift kun viser *"partnere med kalenderplads"*. Det forudsætter
Cal.com multi-host (fase 2). Hele puljen vises indtil da. `TODO(mads): kalenderplads-filter`.

## Konsekvenser

- **Positive:** algoritmen er ren og fuldt unit-testet (17 tests) uden DB; de to hårde spec-krav
  (2-3 partnere, mindst 1 intern) er håndhævet og testet; deterministisk output gør matchet
  reproducerbart og testbart; tie-break er isoleret i én funktion og kan skiftes ud på ét sted.
- **Negative / pris:** grådig giver ikke nødvendigvis det mindst mulige board. At vælge den interne
  først kan i sjældne tilfælde koste en plads (hvis en ekstern alene dækkede alt), til gengæld for
  at intern-kravet altid holder. Infobaren afviger fra byggespec'ens ordlyd indtil pris er afklaret.
- **Opfølgning:** når ejer fastlægger tie-break, udskiftes `byDeterministicOrder`. Når pris er
  fastlagt, udvides infobaren. Når fase 2 lander, filtreres puljen på kalenderplads.
