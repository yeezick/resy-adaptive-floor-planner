# ADR-0007 — CI/CD pipeline: required gates, advisory signals and an AI reviewer

**Date:** 2026-11-03 · **Status:** Accepted

## Context

The prototype should show how an AI feature is shipped safely, not only that it works. CI needs a clear line
between checks that block a merge and signals that inform a reviewer, and every paid API call needs a cap.

## Decision

**Required (block merge):** `pr-title`, `lint-typecheck`, `test` (with the src/domain coverage gate),
`build` (plus a no-key-in-bundle check), `evals-deterministic` and `gitleaks`. All run on the full tree.

**Advisory (inform, never block):**

| Workflow        | What it adds                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-review`     | Claude reviews every non-draft PR into one sticky comment. Opus 5.5 on the room model, agent, prompts, evals and CI; Sonnet 5.5 elsewhere. Kill switch: `AI_REVIEW_ENABLED=false`. |
| `evals-live`    | Real agent + judge run under `EVAL_RUN_BUDGET_USD`, automatically on AI-surface PRs, on the `eval/run` label and nightly.                                                          |
| `e2e`           | Playwright smoke tests on the production build at iPad and desktop sizes; the agent route is stubbed, so no spend.                                                                 |
| `codeql`        | SAST with the `security-extended` query pack; results in the Security tab.                                                                                                         |
| `audit`         | `pnpm audit` (prod, gate at high) with the full report kept, plus dependency review on PRs.                                                                                        |
| `quality`       | Duplicate-code check (jscpd, fails above 5%) and a coverage summary on the run page.                                                                                               |
| `branch-sweep`  | Twice-weekly deletion of branches whose PR merged.                                                                                                                                 |
| `pr-automation` | Native auto-merge once required checks pass; off until the `main` ruleset exists (`AUTO_MERGE_ENABLED`).                                                                           |

Every action is pinned to a full commit SHA. Workflows default to `contents: read` and widen per job.
Secrets never reach fork PRs. The AI reviewer and live evals treat PR text as data, not instructions.

Trade-offs, stated plainly:

- `audit` gates production dependencies at **high** but dev dependencies only at **critical**: a high advisory in
  a build or test tool is reported, not blocking, because it never ships to the server.
- `evals-live` on PRs re-runs on every push to a PR whose files touch the AI surface (judged on the whole PR, so a
  newer push that cancels an older run still measures the change), each run capped at `EVAL_RUN_BUDGET_USD`. There is no per-PR total cap; many AI-surface pushes cost many runs. The kill switch is
  removing the `ANTHROPIC_API_KEY` secret or disabling the workflow.
- When a changed-file list can't be read, the reviewer picks Opus and live evals run: both fail toward more scrutiny.

## Consequences

A model's opinion never blocks a merge; deterministic checks do. AI review costs roughly cents to a dollar
per push depending on tier, and is switched off with one variable.
