# Lokale gates: git-hook og Claude Code-hooks

Repoet har to lag af lokale gates. Begge kører typecheck + unit-tests, ikke integration eller
db (dem dækker CI). Opsætningen er besluttet i ADR 0028.

## 1. Git-hook (husky) — for almindelig git-brug

- `.husky/pre-push` kører `npm run check && npm run test:unit` ved `git push`.
- Wiringen sker af `npm install`: scriptet `prepare` i `package.json` kører `husky`, som
  sætter `core.hooksPath` til `.husky/_`. Uden en `npm install` i klonen er hooket ikke aktivt.
- `.husky/` indeholder kun `pre-push`; der er ingen `pre-commit`-hook.

## 2. Claude Code-hooks — for Claude Code-sessioner

`.claude/settings.json` er checked in og registrerer to `PreToolUse`-hooks. De er aktive
for alle sessioner i repoet uden yderligere opsætning:

| Matcher | Script | Hvad det gør |
|---|---|---|
| `Bash` | `gate-on-push.sh` | Hvis kommandoen indeholder `git push`, kører typecheck + unit. Fejler de, blokeres kaldet (exit 2). Andre Bash-kald slipper igennem. |
| `mcp__github__create_pull_request` | `run-pre-pr-gate.sh` | Kører typecheck + unit før en PR oprettes. Fejler de, blokeres oprettelsen. |

`--no-verify` omgår kun git-hooket i punkt 1. Claude-hooket kører før kommandoen og
ser kun på kommandoteksten, så det stopper et `git push --no-verify` lige så vel.

Hooks i `settings.json` peger på scripts via `$CLAUDE_PROJECT_DIR`.
