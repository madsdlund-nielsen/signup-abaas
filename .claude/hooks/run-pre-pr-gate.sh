#!/usr/bin/env bash
# PreToolUse-hook før PR-oprettelse: typecheck + unit tests skal være grønne.
# Holdes til hurtige, docker-fri checks; integration/db dækkes af CI.
set -euo pipefail

echo "🛡  pre-PR-gate: typecheck + unit tests..." >&2
if npm run --silent check && npm run --silent test:unit; then
  exit 0
fi
echo "❌ pre-PR-gate fejlede — ret fejl før PR oprettes." >&2
exit 2
