# 0045 — Netlify-MCP: skriveadgang til projektindstillinger på eksplicit instruks (erstatter 0037's Netlify-del)

- **Status:** Accepteret
- **Dato:** 2026-09-15
- **Fase:** løbende (erstatter Netlify-delen af ADR 0037; Supabase-delen står uændret)
- **Berører uafklaret punkt:** nej (drift/adgang; ADR 0008's env-struktur ændres ikke — kun hvem der kan sætte en variabel i Netlify)

## Kontekst

ADR 0037 blokerede alle tre skrivende Netlify-værktøjer (`*-updater`) via `permissions.deny` i
`.claude/settings.json`, så MCP'en kun kunne læse. Begrundelsen var merge-økonomien: en deploy
eller en env-var-ændring uden om merge-flowet var en usporet vej ind i prod.

To ting har ændret sig siden:

1. **Merge-økonomien er ophævet (ADR 0042).** Vi shipper små PR'er og deployer ofte, og
   sua-abaas.netlify.app er der Mads klikker. Demo-tilstanden (ADR 0041) er kun synlig når
   `FLAG_DEMO=true` er sat på sitet — en env-var, ikke kode. Med deny-listen fra 0037 kunne
   Claude Code hverken sætte den eller verificere den, så flaget har stået usat siden 14/9,
   mens PR #47 og #48 blev merget. Loopet *sæt flag → deploy → klik* kunne ikke lukkes herfra.
2. **Deny-listen matchede formentlig ikke længere.** Serveren registreres i dag som
   `mcp__Netlify__…` (stort N), mens 0037's regler stod med `mcp__netlify__…`. Reglerne var
   dermed muligvis døde for alle tre værktøjer — også de to vi fortsat vil blokere.

Ændringen kunne ikke laves af Claude Code selv: harnesset afviser at agenten redigerer sine egne
permissions ("Self-Modification"), uanset instruks. Mads committede den derfor selv (PR #49,
foldet ind i PR #50 for at spare en Netlify-deploy). Backlog B-22 bad om denne ADR, når
commit'en forelå.

## Overvejede muligheder

- **Behold 0037 uændret; sæt env-vars i Netlify-UI'et** — ingen ny adgang, men flaget forbliver
  et manuelt skridt, og den hurtigere interaktion i ADR 0042 forudsætter at Claude Code kan lukke
  sine egne loops. Casing-fejlen skulle rettes under alle omstændigheder.
- **Tillad alle tre updatere** — hurtigst, men deploy-updateren kan udløse en produktions-deploy
  uden om merge-flowet, og extension-updateren kan ændre integrationer. Ingen af delene har vi et
  behov for.
- **Tillad kun `project-services-updater`, på eksplicit instruks** — dækker env-vars og
  projektindstillinger (det eneste behov) og bevarer blokeringen af deploy og extensions i
  begge stavemåder.

## Beslutning

**`mcp__Netlify__netlify-project-services-updater` (og den gamle stavemåde) står på
`permissions.allow`; deploy- og extension-updaterne står på `permissions.deny` i begge
stavemåder.** Supabase-delen af ADR 0037 er uændret: ingen skrivning til sandhedskilden uden om
migrationsflowet (ADR 0015).

Reglen for brugen af adgangen:

- **Kun på eksplicit instruks fra Mads i samtalen** — aldrig på eget initiativ og aldrig som
  "opfølgning" på noget andet. En instruks gælder én ændring; den bærer ikke over til den næste.
- **Kun env-vars og projektindstillinger.** Ingen deploys, ingen extensions, ingen sletning af
  sitet. Sletter eller omdøber aldrig en variabel Mads ikke har nævnt.
- **Rapportér hvad der blev sat** i klartekst i samme svar — værdier der er hemmeligheder
  gengives ikke.
- **`.claude/settings.json` skal være gyldig JSON.** En fil der ikke kan parses, kan ikke
  anvendes — så forsvinder deny-listen og hookene (push-gaten, PR-gaten) med den. Mads' commit
  havde et efterhængende komma efter sidste allow-post; det er rettet i samme PR. Verificér med
  `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"`.

Adgangen er stadig klienthåndhævet, og i auto-tilstand ligger der desuden en klassifikator over
hvert kald, som kan afvise handlingen uanset allow-listen. Allow-reglen fjerner deny-listen som
blokering; den garanterer ikke at kaldet går igennem. Første brug efter denne ADR:
`FLAG_DEMO=true` på sua-abaas.

## Konsekvenser

- Positive: Claude Code kan lukke loopet *sæt flag → deploy → klik*, når Mads beder om det.
  Casing-fejlen er rettet, så de tilbageværende deny-regler faktisk matcher. B-22 er lukket.
- Negative / pris: en ny vej til produktions-env-vars, sporet i samtalen frem for i git. Hvad der
  må ligge hvor (ADR 0008) er uændret: en variabel der sættes i Netlify, skal fortsat stå i
  `.env.example`. Deny-listen skal vedligeholdes i **begge** stavemåder, indtil servernavnet er
  stabilt.
- Opfølgning:
  - 🟡 Netlify-MCP'en kræver re-autorisation i claude.ai-connectorerne før første brug
    (konstateret 2026-09-15).
  - 🟡 Får harnesset en serverhåndhævet scope for MCP-værktøjer, så flyt reglen dertil og slank
    allow-/deny-listen.
