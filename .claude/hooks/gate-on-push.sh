#!/usr/bin/env bash
# PreToolUse(Bash)-hook: blokér 'git push' hvis typecheck + unit tests fejler.
# Alle andre Bash-kald slippes igennem med det samme.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write((JSON.parse(s).tool_input||{}).command||"")}catch{process.stdout.write("")}})' 2>/dev/null || true)"

case "$cmd" in
  *"git push"*) ;;
  *) exit 0 ;;
esac

echo "🛡  push-gate: typecheck + unit tests..." >&2
if npm run --silent check && npm run --silent test:unit; then
  exit 0
fi
echo "❌ push-gate fejlede — ret fejl, eller push bevidst med --no-verify." >&2
exit 2
