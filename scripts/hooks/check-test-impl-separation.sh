#!/usr/bin/env bash
# pre-commit: a commit may not mix test files (*.test.*) with implementation files.
# Keeps tests honest: a test is never rewritten in the same commit as the code it judges.
set -euo pipefail
has_test=0; has_impl=0
while IFS= read -r f; do
  if [[ "$f" =~ \.(test|spec)\.(ts|tsx)$ ]]; then has_test=1
  elif [[ "$f" =~ ^(src|evals)/.*\.(ts|tsx)$ ]]; then has_impl=1; fi
done < <(git diff --cached --name-only --diff-filter=ACMR)
if [[ $has_test -eq 1 && $has_impl -eq 1 ]]; then
  echo "anti-mutation guard: split tests and implementation into separate commits." >&2
  exit 1
fi
exit 0
