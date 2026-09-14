# 0042 — Inverteret udviklingsloop: byg → klik → design → ship

- **Status:** Accepteret
- **Dato:** 2026-09-14
- **Fase:** løbende (arbejdsform)
- **Berører uafklaret punkt:** nej — den ændrer *hvordan* uafklarede punkter besvares, ikke hvem der besvarer dem.

## Kontekst

a16z (september 2026): det gamle udviklingsloop er `idé → skriv spec → design → byg → ship →
lær`; det nye er `idé → byg → leg med det → design → ship → lær`. Spec'en forsvinder, og
design flytter om bag byg, fordi byg er blevet billigt nok til at være måden man lærer på.

ABaaS kørte rent i det gamle loop. Målt 2026-09-14: 97 commits på 12 uger, men **6 af 12
uger uden én commit**; 4.967 linjer dokumentation mod 9.543 linjer kode; alle ni
leverandørmoduler stub-aktive; ordene *demo-tilstand* og *sandkasse* forekom nul gange i
dokumentationen. Barriererne, rangeret efter hvad de kostede i uger:

1. **Ingen steder at klikke.** Seks moduler kastede; rejsen stoppede fire steder. Når man
   ikke kan klikke, må man forudsige — og forudsigelse kræver spec, som kræver
   beslutninger, som kræver ejeren. De døde uger var ventetid. Byggespec v5 og de
   detaljerede arbejdspakker var kompensation for det manglende feedback-loop, ikke årsagen.
2. **"Byg ikke uden konto."** `docs/fase-3-rapport.md` §8 og `docs/fase-4.md`: *"bør ikke
   startes for at producere stubs … rigelig plads."* Skærmen blev ikke bygget før
   leverandøren var på plads. Vi skrev selv reglen.
3. **Merge-økonomien** (CLAUDE.md, stående ordre 2026-07-22): en hel fase i ÉN PR. Fase 1–3
   landede hver i én commit; fase 2 blev aldrig gennemgået. Deploy-on-push til
   sua-abaas.netlify.com fandtes hele tiden — reglen forbød at bruge den ofte. Omkostningen
   blev aldrig målt (backlog B-17).
4. **Fase-gates:** bredde før dybde. Man kan ikke klikke på et lag, kun på en rejse.
5. **"Uafklarede punkter — må ikke beslutte":** hvert designvalg blev til ugers ventetid.
6. **ADR-on-decision:** billigst af alle (40 ADR'er ≈ 26 % af dokumentationen), men timet
   forkert — "skriv ADR før du går videre" placerer design før byg.

Mads' præcisering: det er produktionskode, ikke prototyper. ABaaS skal leveres til Andreas
og Mette, gerne snart. Det der ændres er hastigheden i interaktionen.

## Overvejede muligheder

- **Trim kanterne:** behold faser og ADR-on-decision, fjern kun merge-økonomien. Rører ikke
  det der kostede uger.
- **Fuld reset:** skrot fase-dokumenter og ADR-indekset som proces. Smider viden væk der er
  billig at beholde.
- **Inverter loopet:** demo-tilstand (ADR 0041) gør rejsen klikbar; små PR'er; skærm-først;
  ADR ved ship. Stub-politik, adapter-mønster og integritetsgrænser består. **Valgt.**

## Beslutning

1. **Små PR'er, ship ofte.** Merge-økonomien ophæves (Mads, 2026-09-14). Hver PR er én
   skive eller én skærm og skal kunne ses på sua-abaas.netlify.com. Backlog B-17 lukkes.
2. **Skærm-først.** Det der udestår bygges i rækkefølgen: skærm med demo-data → Mads klikker
   og designer → logik kobles → rigtig adapter droppes ind. Skærmen er produktionskode fra
   første commit; kun datakilden skifter. "Byg ikke uden konto"-anbefalingen er trukket
   tilbage i fase-3-rapporten og fase-4.md.
3. **Vertikale skiver i stedet for fase-gates.** Enheden er en rejse man kan klikke, ikke et
   lag. Fase-dokumenterne bliver opslagsværk — de slettes ikke, de gater ikke.
4. **ADR-on-ship.** ADR'en skrives i den PR der shipper skiven, når designet har overlevet
   klik. Stadig obligatorisk for Spand A, stadig i samme PR — bare efter, ikke før.
5. **Uafklarede punkter besvares klikbart.** Byg den simpleste klikbare version bag flag; er
   det et designvalg, vis to. Undtagelserne står uændret: aldrig opfundne pris-/moms-/
   honorartal i produktionskodestier; aldrig stubbe eller demo'e de fem integritetsgrænser.

Det der IKKE ændres: stub-politikken, adapter-/port-mønstret (ADR 0004), RLS som primært
autorisationslag, fuld test suite som merge-gate, og dækningstærsklerne (de rammer kun
`src/components`, `src/server/flags`, `src/server/auth` og var aldrig flaskehalsen).

## Konsekvenser

- Positive: interaktionen måles i timer, ikke uger. Første leverance (denne PR) indeholder
  ikke én ny feature — og gør fase 1–4 klikbare fra ende til anden.
- Negative/pris: flere Netlify-builds. Omkostningen har aldrig været målt; er den reel,
  måles den nu i stedet for at antages. Review pr. PR er tilbage — det er en gevinst, men
  det er også arbejde.
- Opfølgning: demo-seed til befolket tilstand (næste PR); `FLAG_DEMO=true` sættes i
  Netlify af Mads; skærm-først-kandidaterne står i CLAUDE.md § Byggefaser.
