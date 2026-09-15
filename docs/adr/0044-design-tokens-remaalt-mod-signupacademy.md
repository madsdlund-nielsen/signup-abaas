# 0044 — Design-tokens re-målt mod signupacademy.com: det levende site vinder

- **Status:** Accepteret
- **Dato:** 2026-09-15
- **Fase:** løbende (design er acceptkriterium, ikke en fase)
- **Berører uafklaret punkt:** nej. Brandpunkterne i ADR 0039 står stadig hos ejerne.

## Kontekst

Mads sammenlignede signupacademy.com og sua-abaas.netlify.app side om side (2026-09-15):
*"små men vigtige designmæssige fejl — forskelle i bredde, fonts, farver og udtryk."*
SignUp Academy er hovedvirksomheden; ABaaS er en ydelse fra den og skal ligne den.

Tokens var "bekræftet via computed styles" (2026-06-26). Sitet er siden bygget om i Divi 5
med theme builder, og en direkte måling i sitets CSS (`et-core-unified-*.css` + de globale
variabler `--gvid-*`/`--gcid-*`) viste seks konkrete afvigelser:

| Egenskab | Sitet (målt) | Vores | Effekt |
|---|---|---|---|
| Indholdsbredde | **1300 px** (`--gvid-5dobbu3r52`, rows 90 %) | 1160 px | alt 140 px smallere |
| Hero-række / luft | **1400 px**, **155 px** top/bund (85 mobil) | 1160 px, 90 px | hero'en sad trangt og højt |
| H1 | 61 px / **400** | 61 px / **300** | for tynd — den mest synlige "font-forskel" |
| H2 | **calc(30px + 1vw)** / 300 / 1.4 / centreret | 45 px / venstre | mindre og anderledes placeret |
| H3 | **26 px / 400 / sentence case** | 24 px / versal / 1 px | forkert karakter på alle app-sider |
| Nav | **13 px / 500 / ren hvid** | 14 px / 600 / dæmpet hvid | tungere og mattere; **500 var ikke indlæst** |
| Lead | **20 px / 400 / 1.6 / hvid** | 24 px / 1.5 / dæmpet | for stor |
| Sektionsluft | **100 px** | 90 px | tættere rytme |
| Top-kontaktbar | navy `#263753`, e-mail · telefon centreret | fandtes som komponent, ikke i layoutet | kromet manglede et lag |

Farverne stemte (navy, charcoal, guld, lysegrå, brødtekst, slate) — bortset fra
top-baren (målt `#263753`, ikke `#222F4A`) og foto-overlayet (`rgba(34,53,57,.77)`, ikke navy).

## Overvejede muligheder

- **Justér efter øjemål ud fra screenshots.** Hurtigt, men gætværk — præcis det "små men
  vigtige" fejl opstår af.
- **Mål sitets CSS og overfør værdierne 1:1.** Deterministisk og efterprøveligt. **Valgt.**
- **Brug designmanual v1.2 som facit.** Manualen og sitet afviger (fx versal h3, hero-vægt).
  Mads afgjorde: sitet vinder — det er det, ejerne ser ved siden af.

## Beslutning

1. **Tokens** (`docs/design-tokens.css`, spejlet i `src/styles/`) får sitets målte værdier:
   `--container-max: 1300px`, `--container-hero: 1400px`, `--space-section: 100px`,
   `--space-hero: 155px`, `--fs-h2: calc(30px + 1vw)`, `--fs-h3: 26px`/`--lh-h3: 1.4`,
   `--fs-lead: 20px`/`--lh-lead: 1.6`, `--fs-nav: 13px`, `--fw-medium: 500`,
   `--color-topbar-navy: #263753`, `--color-steel: #697EA5`, `--overlay-hero`. Divi's
   breakpoints (980/767) er med som media queries på tokens.
2. **Komponenter:** `.heading-1` vægt 400; `.heading-3` sentence case; nav 13/500/hvid;
   `.lead` 20/1.6, hvid på mørk; `TopBar` i rodlayoutet med e-mail og telefon;
   `SectionBand hero` (1400/155); `.band__intro` centrerer sektionsintroerne på forsiden.
   Open Sans indlæses nu også i vægt 500.
3. **Regel fremover:** ved konflikt mellem designmanual v1.2 og signupacademy.com vinder
   sitet. Tokens re-måles mod sitets CSS — ikke justeres efter øjemål.
4. **Bevidst ikke gjort:** hero-foto (kræver et asset — licensen er SignUp Academys);
   brødtekst 500 (Divi-global, men sitets moduler bruger 400 flere steder); eyebrows på
   forsiden (vores signatur, sitet bruger dem ikke). De tre er varianter Mads afgør ved klik.

## Konsekvenser

- Positive: forside og krom står nu i sitets egne mål. Fejlene er lukket ved kilden
  (tokens), ikke pr. side. Målingen er reproducerbar: hent sitets CSS, grep de samme regler.
- Negative/pris: alle app-sider bliver 140 px bredere og alle h3'er skifter fra versal til
  sentence case — det skal ses efter side for side (Mads klikker). Den gamle "bekræftet via
  computed styles"-status var forkert; det er noteret i `docs/designnoter.md`.
- Opfølgning: hero-foto som næste lille PR når assettet findes; de to varianter.
