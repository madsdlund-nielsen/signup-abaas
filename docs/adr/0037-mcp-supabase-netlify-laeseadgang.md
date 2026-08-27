# 0037 — Supabase- og Netlify-MCP: læseadgang ja, skriveadgang nej

- **Status:** Accepteret
- **Dato:** 2026-08-27
- **Fase:** 3
- **Berører uafklaret punkt:** nej (indsnævrer rækkevidden af ADR 0015 og ADR 0008 uden at
  ændre deres beslutninger).

## Kontekst

Vi har tilsluttet to MCP-servere i `.mcp.json`, så Claude Code kan tale direkte med Supabase
(`https://mcp.supabase.com/mcp`) og Netlify (`https://netlify-mcp.netlify.app/mcp`).

Værdien er verifikation: `list_tables`, `get_advisors`, `query_logs`,
`generate_typescript_types` og docs-opslag gør det muligt at kontrollere at prod faktisk matcher
`supabase/migrations/` — i stedet for at antage det. Netlify-siden giver tilsvarende indblik i
deploys, build-logs og projektindstillinger.

Men adgangen kommer med et skrivelag der kolliderer med to allerede trufne beslutninger:

- **ADR 0015:** alt der skal i prod ligger i `supabase/migrations/`, og Supabase↔GitHub-
  integrationen deployer ved merge til `main`. MCP'ens `apply_migration` og `execute_sql`
  omgår begge dele. Et schema påført gennem MCP registreres ikke i
  `supabase_migrations.schema_migrations` og divergerer tavst fra migrationsfilerne — præcis den
  fejltilstand ADR 0015 blev skrevet for at lukke, efter at manuelle SQL-editor-ændringer kostede
  en lang fejljagt i fase 1.1.
- **Merge-økonomi (CLAUDE.md) og ADR 0008:** Netlifys `deploy-services-updater` kan udløse en
  produktions-deploy uden om merge-flowet, og `project-services-updater` kan ændre
  miljøvariabler uden om den env-struktur ADR 0008 fastlagde.

Supabase er sandhedskilde for forretningsdata (arkitekturprincip 1). Et værktøj der kan skrive
til sandhedskilden uden for det sporede flow er ikke en bekvemmelighed — det er en ny,
usporet vej ind i prod.

## Overvejede muligheder

- **Ingen MCP-servere** — ingen ny risiko, men vi mister den verifikation der ville have
  fanget policy-hullet i ADR 0015 tidligere. Vi bliver ved med at gætte om prod matcher repoet.
- **Fuld MCP-adgang** — hurtigst i øjeblikket, men gør ADR 0015's flow til én af to veje ind i
  prod. To veje til samme schema er ikke et flow, det er en kappestrid.
- **`?read_only=true` på Supabase-URL'en** — serverhåndhævet frem for klienthåndhævet, hvilket
  er stærkere. Men query-parametre på URL'en får OAuth-flowet til at fejle (se nedenfor), og
  parameteren dækker kun Supabase, ikke Netlify.
- **Læseadgang via MCP, skriveadgang via deny-liste** — ét flow ind i prod bevares, mens
  verifikationsværktøjerne er tilgængelige.

## Beslutning

**Tilslut begge MCP-servere, og bloker deres skrivende værktøjer via `permissions.deny` i
`.claude/settings.json`.**

Blokeret på Supabase: `apply_migration`, `execute_sql`, `deploy_edge_function`, samtlige
branch-værktøjer (`create/delete/merge/reset/rebase_branch`) og samtlige projekt-livscyklus-
værktøjer (`create/pause/restore_project`). Blokeret på Netlify: alle tre `*-updater`-værktøjer.
Alt læsende er tilladt.

`execute_sql` er blokeret selv om den også kan læse: den kan skrive, og en tilladelsesregel kan
ikke skelne. Læsebehovet dækkes af `list_tables`, `list_migrations`, `get_advisors` og
`query_logs`.

**Vejen til prod er uændret:** migration-fil i `supabase/migrations/` → PR → merge til `main` →
Supabase↔GitHub-integrationen anvender den. MCP'en verificerer resultatet; den frembringer det ikke.

`.mcp.json` committes. Den indeholder ingen hemmeligheder — kun to URL'er; OAuth-tokens ligger i
den enkelte udviklers lokale credential-store. Det følger fortilfældet fra `.claude/settings.json`,
hooks og skills, som allerede er versionsstyret.

### Sidebemærkning: URL'en må ikke have query-string

Supabase-MCP'ens OAuth-flow fejler med `resource: Resource must be a valid MCP endpoint`, hvis
URL'en i `.mcp.json` bærer query-parametre (`?features=…`, `?read_only=…`). Klienten sender den
konfigurerede URL verbatim som RFC 8707 `resource`-parameter, og `api.supabase.com` sammenligner
den med den registrerede resource, som er nøjagtig `https://mcp.supabase.com/mcp`. Derfor står
URL'en bar. Det er også grunden til at `?read_only=true` ikke var farbar som primær løsning.

## Konsekvenser

- Positive: prod kan verificeres mod repoet (schema, advisors, logs) uden at åbne en ny vej ind i
  prod. `generate_typescript_types` mod det rigtige projekt. Netlify-build-logs uden at forlade
  editoren. Én sporet vej til prod-schemaet består.
- Negative / pris: schemaændringer bliver ikke hurtigere — de skal stadig gennem migration + PR +
  merge, hvilket koster en Netlify-redeploy (merge-økonomi). Deny-listen er klienthåndhævet:
  den beskytter mod utilsigtet brug, ikke mod en bruger der bevidst fjerner linjen. Listen skal
  vedligeholdes, hvis leverandørerne tilføjer nye skrivende værktøjer.
- Opfølgning:
  - 🟡 Hvis Supabase gør `read_only` konfigurerbar uden query-string (fx per-token-scope ved
    autorisation), så skift til serverhåndhævet read-only og slank deny-listen tilsvarende.
  - 🟡 `branching`-featuren blev fravalgt sammen med query-strengen. Hvis vi senere vil have
    preview-brancher, kræver det både at feature-parameteren kan sættes og at branch-værktøjerne
    gentages op — begge dele er en ny beslutning, ikke en justering af denne.
