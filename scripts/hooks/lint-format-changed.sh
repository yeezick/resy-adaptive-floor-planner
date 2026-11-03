#!/usr/bin/env bash
# PostToolUse(Write|Edit): eslint --fix + prettier on the edited file. Advisory, never blocks.
set -uo pipefail
payload=""
if [[ ! -t 0 ]]; then payload=$(cat 2>/dev/null || true); fi
file_path=$(printf '%s' "$payload" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))
except Exception: pass' 2>/dev/null || true)
[[ -z "$file_path" || ! -f "$file_path" ]] && exit 0
if [[ "$file_path" =~ \.(ts|tsx)$ ]]; then pnpm exec eslint --fix --max-warnings 0 "$file_path" || true; fi
if [[ "$file_path" =~ \.(ts|tsx|json|md|css|yml|yaml)$ ]]; then pnpm exec prettier --write --log-level warn "$file_path" || true; fi
exit 0
