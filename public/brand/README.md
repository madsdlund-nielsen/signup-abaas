# Brand-mærker — Advisory Board Unlimited

Kilde: **Designmanual v1.2 (august 2026)** + logo-handoff fra Claude Design. Alle mærker er
tegnet som **outline-kurver** i Open Sans, så ingen skrift skal være installeret for at
gengive dem. Transparent baggrund.

Farverne i filerne er identiske med `docs/design-tokens.css` — navy `#263753`, guld `#B4965D`,
hvid `#FFFFFF`, dæmpet tekst `#4E4E4E`. **Redigér aldrig en farve direkte i en SVG**; afviger
den fra en token, er det tokenfilen der gælder, og så skal mærket tegnes om.

## Hvilket mærke, hvornår

Grænserne er beregnet ud fra hvornår mærkets tyndeste streg rammer én pixel — ikke valgt efter
øjemål. Vælges et mærke uden for sit interval, renderer stregen gråt eller forsvinder.

| Fil | Mærke | Brug fra | Bindende element |
|---|---|---|---|
| `advisory-board-unlimited-lockup-22.svg` | Ordmærket (løsen) | **300 px** bredde | bogstavstreg 2,69 |
| `abu-mark-01-light-on-dark.svg`<br>`abu-mark-01-navy-on-light.svg` | Kortform 01 — Light | **96 px** | pipe og bogstavstreg 6,80 |
| `abu-mark-01-small-*.svg` | Kortform 01 — SemiBold | **32–96 px** | bogstavstreg 14,16 |
| `abu-mark-05-*.svg` | Kortform 05 — med navn | **320 px** | navnelinjen 1,70 |

**Vægtskiftet ved 96 px er en hård grænse.** SemiBold-snittet må aldrig bruges over 96 px —
gør det, står to vægte af samme mærke på samme flade, og det er synligt.

## Farvevarianter

`-light-on-dark` (hvid) dækker **både** charcoal og navy. `-navy-on-light` hører til lyse
flader. Der er ikke en tredje variant, og hele løsen i én farve er kun tilladt ved ensfarvet
tryk hvor guld ikke kan gengives.

Guld på hvid giver 2,81:1. Logotyper er undtaget WCAG 1.4.3, så det er ikke en fejl — men
"unlimited" bliver svagt på hvid ved lille størrelse. Brug den inverse hvor du kan.

## Friareal

Friarealet svarer til x-højden: 4,3 % af løsens bredde. **Intet element må bryde feltet** —
heller ikke sidekant eller beskæring. De kvadratiske mærker leveres i et 512 × 512-felt, som
er mindstefodaftrykket: det må ikke beskæres, og der må ikke lægges baggrundsflade inde i det.
Placeres et mærke på en farvet flise, er flisen 512-feltet — ikke motivets kant.

## Otte ting løsen ikke tåler

Strakt eller stauchet · roteret · hele løsen i guld · ombyttede farver · skygge eller forløb ·
farve uden for paletten · ændret mellemrum · for lidt friareal.

Reglen bag alle otte: udtrykket bæres af form og ro, ikke af effekt.

## ⚠ `advisory-board-unlimited-lockup-03.svg` — brug den ikke

Lockup-03 (Open Tracking-løsen) er **ikke optaget i designmanualen**. Den har ingen pipe,
kræver 352 px blækbredde og er ikke afklaret som sekundær løs (manualens kolofon, åbne
punkter). Filen ligger her fordi den var i repoet før manualen; den er ikke en godkendt
variant. `TODO(ejer)`: afklar dens status, eller slet filen.

## Andre åbne punkter fra manualens kolofon

Disse er **brandbeslutninger, ikke tekniske valg** — de skal træffes af ejer/afsender:

- **Navnelinjens farve i kortform 05.** `#4E4E4E` på lys flade, ren hvid på mørk. På lys
  træder navnet tilbage, på mørk gør det ikke. Filerne bærer i dag begge forhold. Vælg ét.
- **Det lille snit.** Motivet fylder 69 % af kvadratets bredde; ved 32 px lander
  bogstavstregen på 0,88 px. Skaleres motivet til 78 %, rammer den 1,00 px.
- **Linkfarven `#1E73BE`** er WordPress-temaets standardblå, ikke en brandbeslutning — den
  eneste værdi i paletten uden brandbegrundelse.

## Licens

Open Sans: SIL Open Font License 1.1. Mærkerne er sat som kurver, så skriften ikke skal være
installeret for at gengive dem.
