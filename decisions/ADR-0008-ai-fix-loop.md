# ADR-0008 — AI review → auto-fix → auto-merge loop, at most 2 fix rounds

**Date:** 2026-11-03 · **Status:** Accepted (trial: watch the next few PRs)

## Context

The AI reviewer (ADR-0007) finds real defects, but a person still had to read each comment, fix it and push.
We want the loop closed without letting a model merge its own work or loop on its own output.

## Decision

`ai-review.yml` runs four jobs per push to a PR:

1. **hold** turns auto-merge off, so a "clean" verdict for an older commit can never merge newer code.
2. **review** writes one sticky comment and ends it with a hidden line
   `AI-REVIEW-VERDICT: sha=<head> blocking=<number of ❌>`. Only a verdict for the exact head commit counts.
3. **decide**:
   - 0 blocking → auto-merge on (if `AUTO_MERGE_ENABLED=true`). It merges only when the required checks pass.
   - blocking, fewer than 2 rounds used → run **fix**.
   - otherwise, or if the verdict can't be read → label `ai-fix/needs-human`, comment, auto-merge stays off.
4. **fix** (Opus 5.5) edits files only; it has no git write access. The workflow then rejects the change if it
   touches a human-only file (`types.ts`, `schemas.ts`, `rubric.md`, `labels.jsonl`, `ai-review.yml`, `.env*`)
   or if `pnpm verify` fails. Otherwise it commits with an `AI-Fix-Round: N` trailer and pushes, which starts
   CI and a fresh review. Rounds are counted by the `ai-fix/round-N` labels.

Pushes and merges use `AUTOMATION_PAT` (fine-grained, this repo only), because GitHub doesn't start workflows
for pushes or merges made with the default `GITHUB_TOKEN`.

## Consequences

- The model never decides a merge: required checks do. The review only decides whether auto-merge is on.
- The fixer can't raise its own round limit (`ai-review.yml` is off-limits) or edit the human-tier files.
- Worst-case spend per PR, before a person pushes: 3 reviews + 2 fixes, about $3–4 at current Opus prices.
- Kill switches: `AI_REVIEW_ENABLED=false` (whole loop) or `AUTO_MERGE_ENABLED` unset (no auto-merge).
