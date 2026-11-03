#!/usr/bin/env bash
# PreToolUse(Bash) guard. Exit 2 = block the tool call.
# Reads the command from the hook's JSON payload (tool_input.command) so it never fails open
# when an env var is missing.
set -euo pipefail
payload=""
if [[ ! -t 0 ]]; then payload=$(cat 2>/dev/null || true); fi
cmd=$(printf '%s' "$payload" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception: pass' 2>/dev/null || true)
scan="${cmd:-$payload}"
block() { echo "[blocked] $1" >&2; exit 2; }
printf '%s' "$scan" | grep -Eiq '\brm\b[^|;&]*-[a-z]*r[a-z]*f|\brm\b[^|;&]*-[a-z]*f[a-z]*r' && block "recursive-force rm"
if printf '%s' "$scan" | grep -Eq 'git[[:space:]].*push' \
   && printf '%s' "$scan" | grep -Eq -- '(--force([[:space:]]|=|$)|[[:space:]]-f([[:space:]]|$))' \
   && ! printf '%s' "$scan" | grep -Eq -- '--force-with-lease'; then
  block "git push --force (use --force-with-lease on feature branches)"
fi
printf '%s' "$scan" | grep -Eq 'git[[:space:]]+push[[:space:]]+[^|;&]*\borigin[[:space:]]+(HEAD:)?main\b' && block "direct push to main (open a PR)"
printf '%s' "$scan" | grep -Eq '\brailway[[:space:]]+variables?\b' && block "railway variables (set secrets in the Railway dashboard)"
printf '%s' "$scan" | grep -Eq -- '--no-verify' && block "--no-verify (fix the hook failure instead)"
exit 0
