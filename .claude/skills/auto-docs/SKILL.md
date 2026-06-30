---
name: auto-docs
description: Holder ABaaS' governance-/teknisk dokumentation synkron med koden — ADR-on-decision, fase-rapportens flag-punkter, GDPR-leverandør-register + sletteflow, spike-docs og design-tokens (docs↔src). Brug ved arkitektur-/stack-/leverandør-/datamodelvalg, afsluttede spikes, nye sub-processorer, schema- eller token-ændringer, eller når brugeren siger "opdater docs", "skriv ADR", "synk dokumentation". ABaaS har ét-sproget governance-docs (ingen marketing/DA-EN).
allowed-tools: Read, Edit, Write, Bash(git diff:*), Bash(git status:*), Grep, Glob
---

# auto-docs — hold governance-/teknisk docs synkron (ABaaS)

Læs `CLAUDE.md` (rod) og `docs/adr/README.md` først. **CLAUDE.md vinder altid konflikter.**
Denne repo har bevidst **ingen** marketing-/dual-language-docs — kun ét-sproget governance.

## 1. Find ændringens omfang
```bash
git diff --name-only
git status --short
```

## 2. ADR-on-decision (OBLIGATORISK)
Hvis ændringen er et **arkitektur-, stack-, leverandør-, datamodel- eller domænegrænse-valg**
(Spand A i CLAUDE.md) — eller afslutter en spike — så skriv en kort ADR **i samme PR**:
1. Kopiér `docs/adr/0000-template.md` → `NNNN-kort-titel.md` (næste ledige nummer).
2. Udfyld: kontekst, overvejede muligheder, beslutning, konsekvenser. Sæt status `Accepteret`.
3. Tilføj linjen i indekset i `docs/adr/README.md`.
4. Erstat aldrig en gammel ADR — skriv en ny der erstatter den, og markér den gamle.

## 3. Uafklarede punkter (Spand C) — flag, beslut ikke
Rører ændringen et uafklaret punkt? Markér i kode med `// TODO(ejer):` / `// TODO(mads):`,
byg bag feature-flag hvis muligt, og saml punktet i `docs/fase-0-rapport.md` (§2/§3).
**Opfind aldrig et svar.**

## 4. Sub-processor-/GDPR-ændring
Ny eller ændret sub-processor → opdatér `docs/gdpr/leverandoer-register.md` (datatype, region,
EU-residens, DPA-status, flag) og `docs/gdpr/sletteflow.md` hvis sletning påvirkes.

## 5. Spike-fremskridt
Nye fund i en spike → opdatér `docs/spikes/<spike>.md` (kriterie-tabel/resultater). **STOP ved
selve valget** — hosting/auth/multi-host besluttes af Mads/ejer, ikke her.

## 6. Design-tokens i sync
Token-ændring → hold `docs/design-tokens.css` (kanonisk kilde) og `src/styles/design-tokens.css`
identiske. Redigér kilden i `docs/` og spejl til `src/styles/`.

## 7. Hold fase-rapporten aktuel
Flyt punkter fra "afventer" → "leveret" i `docs/fase-0-rapport.md` når de lukkes; tilføj nye
flag-punkter under §3.

## 8. Rapportér
Hvilke ADR'er/docs blev oprettet/opdateret, og hvilke flag-punkter der står tilbage.

## Vigtige regler
- ADR er **obligatorisk** ved beslutninger — ikke valgfri, og i samme PR som koden.
- Beslut aldrig et uafklaret punkt; flag det.
- Slet aldrig docs; erstat ADR'er ved at skrive en ny.
- Ingen marketing-/dual-language-docs i denne repo (det er en bevidst forskel fra qlim8).
