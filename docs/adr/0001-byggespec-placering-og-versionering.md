# 0001 — Byggespec: placering og versionering

- **Status:** Accepteret
- **Dato:** 2026-06-26
- **Fase:** 0
- **Berører uafklaret punkt:** nej

## Kontekst

Den fulde, menneske-skrevne byggespec (`ABaaS_Byggespec_v5.pdf`) var hidtil kun
refereret i `CLAUDE.md` og `docs/projektstruktur.md` på stien
`docs/ABaaS_Byggespec_v5.pdf`, men selve filen lå ikke i repoet. Ejeren ønsker
at specen ligger fast i repoet og vil **løbende lægge opdaterede versioner ind**
efterhånden som spec'en ændres eller udvides. Vi har derfor brug for en stabil
placering og en konvention for hvordan nye versioner håndteres, så referencer
ikke knækker hver gang spec'en opdateres.

## Overvejede muligheder

- **Enkelt versioneret fil i `docs/`-roden** (status quo, `docs/ABaaS_Byggespec_v5.pdf`)
  — enkelt, men blander spec-binæren med arbejdsdokumenterne, og hver
  versionsbump kræver at referencer i flere filer rettes.
- **Stabilt filnavn (`ABaaS_Byggespec.pdf`) der overskrives** — referencer
  knækker aldrig, men menneske-læsbar versionshistorik forsvinder (kun binær
  git-historik tilbage), og det er svært at pege på "den version vi byggede
  efter".
- **Egen mappe `docs/byggespec/` med versionerede filnavne + README som indeks**
  — adskiller spec-reference fra arbejdsdokumenter, bevarer eksplicit
  versionshistorik, og en README kan bære "seneste version" + changelog så
  referencer udefra kun peger på mappen.

## Beslutning

Vi lægger menneske-spec'en i sin egen mappe `docs/byggespec/` med versionerede
filnavne (`ABaaS_Byggespec_v5.pdf`, `_v6.pdf`, …) og en `README.md` der angiver
seneste version, versioneringsprocedure og changelog. `CLAUDE.md` og
`docs/projektstruktur.md` peger på mappen frem for en konkret fil, så fremtidige
versionsbump kun rører `docs/byggespec/README.md`. Tidligere versioner slettes
ikke. Spec'en forbliver ren reference — `CLAUDE.md` er fortsat autoritativ og
vinder ved konflikt.

## Konsekvenser

- Positive: stabil referencesti; menneske-læsbar versionshistorik; ejerens
  løbende opdateringer har en defineret, lav-friktions-procedure; spec-binæren
  forurener ikke `docs/`-roden.
- Negative / pris: en smule ekstra disciplin (README skal opdateres ved hver ny
  version); binære PDF'er ligger i git og fylder over tid (acceptabelt ved få,
  små filer).
- Opfølgning: når en ny spec-version afklarer et uafklaret punkt fra `CLAUDE.md`,
  skal `CLAUDE.md` opdateres i samme PR — og en ADR skrives hvis ændringen er et
  arkitektur-, stack-, leverandør-, datamodel- eller domænegrænse-valg.
