#!/usr/bin/env bash
# Stop hook: typecheck + unit tests. Blocking — a red tree cannot end the session.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pnpm typecheck
pnpm test
