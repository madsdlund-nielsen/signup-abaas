---
name: pre-pr-check
description: Kør den lokale pre-PR-gate for signup-abaas (lint + typecheck + unit, samt integration/db hvis Docker kører). Brug når brugeren beder om "check tests før PR", "kør pre-PR gate", "er branchen klar", eller før en PR oprettes manuelt.
allowed-tools: Bash(npm run lint:*), Bash(npm run check:*), Bash(npm run test:unit:*), Bash(npm run test:integration:*), Bash(npm run test:db:*), Bash(npm run db:test:up:*), Bash(npm run db:test:down:*), Bash(docker info:*)
---

# pre-pr-check — lokal pre-PR-gate (ABaaS)

Verificér at branchen er klar, før du opretter en PR. Spejler det CI kører.

## Hvad den kører
Altid (hurtigt, ingen Docker):
```bash
npm run lint
npm run check        # tsc --noEmit
npm run test:unit
```
Hvis Docker er tilgængeligt (`docker info`), også DB-laget:
```bash
npm run db:test:up           # Postgres + wait-for-db
npm run test:integration
npm run test:db              # inkl. obligatoriske RLS-negative-tests
npm run db:test:down
```

## Forhold til hooks
- `.husky/pre-push` kører allerede lint-gaten (typecheck + unit) ved `git push`.
- De opt-in Claude Code-hooks i `.claude/hooks/` (se README dér) kan gate push + PR-oprettelse,
  hvis du selv tilføjer `.claude/settings.json`.
- Denne skill er til en **manuel** kørsel, fx før du beder om en PR.

## Hvis noget fejler
Ret koden/testen — omgå **ikke** med `--no-verify`. Hvis Docker mangler lokalt, dækker CI
integration/db som sikkerhedsnet, men lint/typecheck/unit skal være grønne før PR.
