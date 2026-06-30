# Claude Code-hooks (opt-in)

Disse scripts spejler qlim8's lokale gates, men de aktiveres **kun** hvis du selv
tilføjer en `.claude/settings.json` der refererer dem. Claude Code skriver bevidst
ikke sin egen `settings.json` automatisk — at ændre agentens startkonfiguration er
din beslutning.

- `gate-on-push.sh` — PreToolUse(Bash): blokerer `git push` hvis typecheck + unit fejler.
- `run-pre-pr-gate.sh` — PreToolUse(`mcp__github__create_pull_request`): samme gate før PR.

`.husky/pre-push` giver allerede push-gaten for almindelig git-brug; ovenstående er kun
relevant for Claude Code-sessioner.

## Aktivér

Opret `.claude/settings.json` med:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/gate-on-push.sh" }] },
      { "matcher": "mcp__github__create_pull_request", "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/run-pre-pr-gate.sh" }] }
    ]
  }
}
```
