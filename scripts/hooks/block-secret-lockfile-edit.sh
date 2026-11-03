#!/usr/bin/env bash
# PreToolUse(Write|Edit) guard. Exit 2 = block.
# Denies agent writes to secrets files (.env, .env.*) and the lockfile (pnpm-lock.yaml is
# changed only by running pnpm). Keyed on the payload's tool_input.file_path; no path = no subject.
set -euo pipefail
payload=""
if [[ ! -t 0 ]]; then payload=$(cat 2>/dev/null || true); fi
file_path=$(printf '%s' "$payload" | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path","") if isinstance(d,dict) else "")
except Exception: pass' 2>/dev/null || true)
[[ -z "$file_path" ]] && exit 0
case "$(basename "$file_path")" in
  .env.example) exit 0 ;;
  .env|.env.*) echo "[blocked] '$file_path' is a secrets file; edit it yourself." >&2; exit 2 ;;
  pnpm-lock.yaml) echo "[blocked] '$file_path' is the lockfile; change it with pnpm." >&2; exit 2 ;;
esac
exit 0
