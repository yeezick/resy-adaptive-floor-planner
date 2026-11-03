# ADR-0008 — AI review → auto-fix → auto-merge loop, at most 2 fix rounds

**Date:** 2026-11-03 · **Status:** Accepted (trial: watch the next few PRs)

## Context

The AI reviewer (ADR-0007) finds real defects, but a person still had to read each comment, fix it and push.
We want the loop closed without letting a model merge its own work or loop on its own output.

## Decision

`ai-review.yml` runs these jobs per push to a PR:

1. **hold** turns auto-merge off, so a clean review of an older commit can never merge newer code.
2. **review** writes one sticky comment. The verdict is the number of lines starting with ❌ in the comment
   that _this run_ wrote (matched by run id), so a stale comment never counts.
3. **decide**:
   - 0 blocking → auto-merge on (if `AUTO_MERGE_ENABLED=true`). It merges only when the required checks pass.
   - blocking, fewer than 2 rounds used → run **fix**.
   - otherwise, if the verdict can't be read, or if no review ran → label `ai-fix/needs-human`, comment,
     auto-merge stays off.
4. **fix** (Opus 5.5) edits a checkout of the reviewed commit. It has no git write access and no push token.
   The workflow rejects the fix unless every changed file is on an allowlist (`src/`, `e2e/`, `fixtures/`,
   `prompts/`, `evals/`) and off a denylist (human-tier files, the eval gate's expectations and transcripts,
   `.env*`), runs `pnpm verify`, and uploads the change as a patch.
5. **push** runs on a clean runner that never installs dependencies or runs repo code. It applies the patch,
   re-checks the allowlist and denylist, commits with an `AI-Fix-Round: N` trailer and pushes with `AUTOMATION_PAT`
   (not forced: a branch that moved since the review rejects it). That push starts CI and a fresh review.

Rounds are counted by the `ai-fix/round-N` labels. Pushes and merges use `AUTOMATION_PAT` (fine-grained, this
repo only), because GitHub doesn't start workflows for pushes or merges made with the default `GITHUB_TOKEN`.

Why the split: code the fixer edits (tests, configs) runs during `pnpm verify`. If that code ran next to the
push token, a prompt injection could make it steal the token. Keeping the token in a job that runs only git
means edited code never shares a machine with it.

Accepted residual risks: edited code that runs during `pnpm verify` can write `$GITHUB_ENV` / `$GITHUB_OUTPUT`
and so influence later steps in the fix job; the push job re-checks the patch on a clean runner, so that can't
widen what gets pushed. While it works, the fixer runs the tests it edits inside the Claude step, whose
environment holds `ANTHROPIC_API_KEY` and a `GITHUB_TOKEN` limited to PR comments and labels. Only same-repo PRs
(collaborators) reach the fixer, the key has a spending limit, and the token can't push. Removing the fixer's
ability to run tests would make its fixes much worse.

## Consequences

- The model never decides a merge: required checks do. The review only decides whether auto-merge is on.
- The fixer can change only app code, tests, fixtures, prompts and eval code. CI, its own round limit,
  dependencies, tool configs, hooks and any new top-level file are outside the allowlist, so they're protected
  by default. Findings there always go to a person.
- The verdict is still model-written text. A forged "clean" only switches auto-merge on; the required checks
  still decide the merge.
- Worst-case spend per PR, before a person pushes: 3 reviews + 2 fixes, about $3–4 at current Opus prices.
- Kill switches: `AI_REVIEW_ENABLED=false` (whole loop) or `AUTO_MERGE_ENABLED` unset (no auto-merge).
