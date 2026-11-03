# CLAUDE.md — Adaptive Floor Planner

Public concept prototype. Synthetic data only. Not affiliated with Resy or American Express.

## Stack

Vite + React + TypeScript client, Express server, one Node service. Room logic is pure TypeScript in
`src/domain/` and is shared by the UI, the agent's tools and the evals. Zod validates every boundary.

## Tier rule

Human-only changes: the room schema (`src/domain/types.ts`), the agent tool contracts
(`src/server/agent/schemas.ts`), the eval rubric (`evals/rubric.md`) and human labels (`evals/labels.jsonl`).
An agent may propose a change to these in a PR description, never make it.

## Agent rules

Recommend, never auto-seat. Tools are read-only. The agent may reference only tables in room state; the
validator rejects anything else. Bump `PROMPT_VERSION` in `prompts/agent.v1.md` whenever the prompt changes.

## Git

Feature branch + PR; conventional commits; squash merge; never push to `main`, never `--no-verify`,
never force-push `main`. Secrets live only in Railway and Actions secrets.

## /verify

`pnpm verify` = lint, typecheck, test, evals-deterministic.
