# 0024 — Transskription og LLM: Ordbogen (ordbogen.ai + chat.dk/Odin)

- **Status:** Accepteret
- **Dato:** 2026-08-03
- **Fase:** 2 (besluttet før fase 4 bygges)
- **Berører uafklaret punkt:** ja — lukker leverandør- og dataresidensspørgsmålet for begge; DPA og samtykke er stadig åbne

> **Beslutningen er Mads'.** Denne ADR dokumenterer den og dens tekniske konsekvenser,
> jf. ADR-on-decision i CLAUDE.md — den træffer den ikke.

## Kontekst

To af fase 4's kernefunktioner har stået blokeret på leverandør- og dataresidensvalg
siden fase 0:

- **Transskription** — CLAUDE.md: *"⚠ dansk/EU-udbyder afsøges"*. Byggespec §12
  punkt 7: *"Transskription + auto-resumé: dansk/EU-udbyder — afsøg og vælg."*
- **AI-opfølgning (LLM)** — CLAUDE.md: *"Anthropic Claude API (eller EU-hostet LLM),
  ⚠ EU/DPA verificeres"*. Byggespec §8 er eksplicit: *"Anthropic pt. uden for EU;
  vælg EU-LLM eller afklar grundlag."*

Begge porte (`src/lib/transcription/`, `src/lib/llm/`) blev bygget leverandørneutrale
i fase 0 (ADR 0004) og har kørt som stubs siden. Ingen af dem har blokeret noget
endnu, fordi fase 4 ikke er startet.

Data i spil er af den følsomme slags: rådoptagelser af fortrolige strategisamtaler
mellem en virksomhedsejer og hendes rådgivere. EU-residens er derfor ikke en
formalitet, men kernen i valget.

## Overvejede muligheder

- **Anthropic Claude API** (LLM) — stærk model, men hosting uden for EU. Ville kræve
  et separat overførselsgrundlag, og løser ikke transskriptionen.
- **EU-hostet generisk LLM + separat EU-transskriptionsudbyder** — to leverandører,
  to DPA'er, to leverandørforhold.
- **Ordbogen for begge** — én dansk leverandør til både tale-til-tekst og LLM.

## Beslutning

**Ordbogen** som leverandør af begge dele:

- **Transskription:** `ordbogen.ai` — dedikeret tale-til-tekst-model.
- **LLM / auto-resumé:** `chat.dk` / Odin-LLM — dansk model, dansk datacenter.

Hele værdikæden ligger dermed i Danmark, og **én leverandør betyder én DPA** — det er
sådan CLAUDE.md's uafklarede-liste behandler punktet ("Ordbogen DPA/databehandleraftale
— dækker både tale-til-tekst og LLM"), og derfor er dette én ADR og ikke to.

Teknisk følger:

- **Portenes interfaces ændres ikke.** Begge forbliver leverandørneutrale (ADR 0004);
  Ordbogen bliver to adaptere bag dem. Skifter vi senere, er det adapterne der udskiftes.
- **Begge forbliver bag feature-flag** — `FLAG_TRANSCRIPTION` og `FLAG_AIFOLLOWUP`,
  begge OFF. De bygges i fase 4.3/4.4.
- **Resuméer gemmes i Supabase** som mødeartefakt, ikke kun hos udbyderen. Supabase
  er sandhedskilde (arkitekturprincip 1).
- `docs/gdpr/leverandoer-register.md` opdateres med Ordbogen som sub-processor.

## Konsekvenser

- **Positive:** dataresidens-spørgsmålet er lukket for begge funktioner på én gang;
  dansk leverandør og dansk sprogmodel passer til et dansk-sproget produkt; ét
  leverandørforhold og én DPA frem for to; ingen overførsel uden for EU at redegøre for.
- **Negative / pris:** vi binder to funktioner til én leverandør — falder Ordbogen
  bort, mangler vi begge. Portmønstret begrænser skaden til to adaptere. En dansk
  niche-model kan desuden være svagere end de største internationale modeller;
  resumékvaliteten bør vurderes konkret i fase 4, ikke antages.
- **Åbent efter denne beslutning — begge blokerer produktionsbrug:**
  - ⚠ **DPA (Mads).** Dansk hosting er **ikke** i sig selv en databehandleraftale.
    Intet må i produktion før den formelle aftale foreligger.
  - 🔴 **Samtykke til mødeoptagelse (ejer).** Byggespec §8 kræver *"eksplicit samtykke
    fra alle deltagere inden opstart"*. Transskription må ikke aktiveres uden
    samtykkeflow, uanset at leverandøren er dansk. **Samtykke må aldrig stubbes**
    (`docs/stub-politik.md`).
  - 🔴 **Note-synlighed (ejer)** gælder også resuméer → restriktiv default indtil afklaret.
