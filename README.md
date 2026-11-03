# Adaptive Floor Planner

> **Concept prototype by Erick Manrique — not affiliated with, endorsed by, or using data from Resy or American Express.**
> All restaurant data in this repository is fictional.

**Host tools today plan the layout ahead of time. This plans tonight's layout from tonight's book.**

Give it tonight's reservations, the base floor plan and what is in storage. It proposes tonight's layout as a list of
changes — tables pushed together, dividers opened, extenders, chairs and spare tables pulled from storage — with an
ordered crew build list, time windows and a reason for every choice. When something can't fit, it says why and keeps
the best partial plan. A person edits the proposal in the same floor-plan editor and applies it.

During service it ranks where a walk-in can sit and how soon, using where each table is in its meal (seated → drinks →
apps → entrées → dessert → check). It **recommends; it never seats anyone.** Everything the agent can do has a manual
control.

## What's inside

- `src/domain/` — the room model in plain TypeScript: meal-phase timing, legal joins, party fit, build plans, and
  `generateTonight`. Shared by the UI, the agent's tools and the evals.
- `src/client/` — host console: waitlist / upcoming / seated / done, floor with room tabs, walk-in suggestions,
  floor-plan editor, named layouts, tonight's layout, and `/evals`.
- `src/server/` — Express API and the agent: read-only tools, a validator that rejects any table or seat count the room
  can't support, per-call cost logging and spend caps.
- `evals/` — golden scenarios, code assertions (CI gate), an LLM judge on a different model, and judge calibration.
- `fixtures/rooms/` — a fictional 126-table room on three nights.
- `decisions/` — architecture decision records.

## Run it

```bash
pnpm install
cp .env.example .env   # add an API key to use the assistant; everything else works without one
pnpm dev               # client on Vite, API on :3001
pnpm verify            # lint, typecheck, tests, deterministic evals
```
