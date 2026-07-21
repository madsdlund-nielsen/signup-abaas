# Spike — Hosting (Henosia DK vs. Netlify IE)

> 🟡 SPIKE (Trin 3, arbejdspakke 0.6). Rører ⚠ punkt 24 + 26. **Claude Code beslutter ikke
> hosting** — undersøg, indsaml data, skriv anbefaling, og STOP ved valget. Mads vælger.
> Forberedelse her er kontofri; selve kørslen kræver konti hos begge udbydere (afventer adgang).

## Formål
Vælg hosting der opfylder: EU-serverplacering, SSR (Next.js App Router) og cron/scheduled jobs.

## Hvad skal verificeres (når adgang er der)
1. Deploy af hello-world fra GitHub til **både** Henosia og Netlify.
2. SSR virker (server-renderede ruter, ikke kun statisk).
3. Cron/scheduled job kan køre (til senere påmindelser/honorar-jobs).
4. EU-serverplacering bekræftet hos begge.
5. Secrets-håndtering (hvordan henter prod sine env-variabler).

## Evalueringskriterier
| Kriterium | Henosia (DK) | Netlify (IE) | Vægt |
|---|---|---|---|
| EU-residens | | | skal-krav |
| SSR (Next 16) | | | skal-krav |
| Cron/scheduled | | | skal-krav |
| Secrets-mekanik | | | vigtig |
| DX / deploy-flow | | | vigtig |
| Pris/begrænsninger | | | info |

## Kontofri forberedelse (kan gøres nu)
- Hold deploy-pipen hosting-neutral (CI bygger; intet deploy-job hardcodet — jf. ADR 0009).
- Undgå hosting-specifikke antagelser i kode (cron-syntaks, build-output, secrets-mekanik).
- Hold hello-world + et SSR-eksempel klar som deploy-prøve.

## Beslutnings-gate
**STOP** efter anbefalingen. Mads vælger host. Først derefter: skriv hosting-ADR (næste ledige
nummer) + tilføj deploy-job til `ci.yml` + host-specifik secret-store.

## Konklusion (2026-07-21)

**Valgt: Netlify** (Mads). Se **ADR 0012**. `netlify.toml` tilføjet (`@netlify/plugin-nextjs`,
Node 22). Deploy sker via Netlifys Git-integration (ikke et Actions-job). Secret-store =
Netlify Environment variables (lukker ADR 0008-opfølgningen). Åbent verifikationspunkt:
🔴 funktions-region skal sættes til EU (Ireland, `dub`) i Netlify-UI'et (kræver ≥ Pro-plan).
