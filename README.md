# Adaptive Floor Planner

[![ci](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/ci.yml)
[![e2e](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/e2e.yml/badge.svg)](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/e2e.yml)
[![codeql](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/codeql.yml/badge.svg)](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/codeql.yml)
[![secret-scan](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/secret-scan.yml)
[![evals-live](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/evals-live.yml/badge.svg)](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/evals-live.yml)

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

## Large-party requests: capacity fit and the cost of saying yes

Parties above the online cap of 8 reach a request inbox from three sources: the **Resy app**'s request form, an
**AI agent** (a chat app or MCP client) booking for a guest, and a **walk-in at the host stand** (the host types it).
Each request gets an AI triage (real vs junk, plus a two-line needs overview) and a **capacity fit** from the
planner: the night's book is planned with and without the party, and it fits only if every existing booking keeps
its seats. The AI never picks tables.

The card weighs yes against no, in covers:

- **Accept:** +N covers (the party) − M covers lost to the hold (est.) = net. The hold starts one 90-minute turn
  before the build, and covers lost = seats × minutes held ÷ 90.
- **Decline:** 0, and the request leaves Resy.
- **Build time ~X min (est.):** crew minutes per step from
  [`fixtures/crew/build-minutes.json`](fixtures/crew/build-minutes.json): 3 per floor table, 3 per extender, 4 per
  spare table from storage, 5 per divider opened, 1 per 4 chairs carried, and never under 10. The same constants set
  the crew list's time windows. Labour cost stays out of the prototype.

Table numbers never carry the fixtures' `T` prefix in anything a person reads ("Combine tables 72, 73 and 74 into an
11-top; bring 2 tables and 6 chairs from storage."). Elapsed time on seated tables is estimated from meal phase and
is labelled "est.".

## What's inside

- `src/domain/` — the room model in plain TypeScript: meal-phase timing, legal joins, party fit, build plans, and
  `generateTonight`. Shared by the UI, the agent's tools and the evals.
- `src/client/` — host console: waitlist / upcoming / seated / done, floor with room tabs, walk-in suggestions,
  floor-plan editor, named layouts, tonight's layout, and `/evals`.
- `src/server/` — Express API and the agent: read-only tools, a validator that rejects any table or seat count the room
  can't support, per-call cost logging and spend caps.
- `evals/` — golden scenarios, code assertions (CI gate), an LLM judge on a different model, and judge calibration.
- `fixtures/rooms/` — a fictional 95-table room on four nights (`demo-night` is the demo's Saturday: 11 large parties, one that can't fit).
- `e2e/` — Playwright smoke tests of the host flows at iPad and desktop sizes.
- `decisions/` — architecture decision records.

## Run it

```bash
pnpm install
cp .env.example .env   # add an API key to use the assistant; everything else works without one
pnpm dev               # client on Vite, API on :3001
pnpm verify            # lint, typecheck, tests, deterministic evals
pnpm build && pnpm e2e # Playwright smoke tests (no API key needed)
```

## CI/CD

Required checks block a merge; advisory ones inform the reviewer. See [ADR-0007](decisions/ADR-0007-ci-pipeline.md).

- **Required:** PR title, lint + typecheck, unit tests with a coverage gate, build, deterministic evals, secret scan.
- **AI loop:** Claude reviews every PR; blocking findings get up to 2 automatic fix rounds, each gated by
  `pnpm verify` before it is pushed; a clean review turns on auto-merge ([ADR-0008](decisions/ADR-0008-ai-fix-loop.md)).
- **Advisory:** live evals with a judge on AI-surface PRs under a
  dollar budget, Playwright e2e, CodeQL, dependency audit + review, duplicate-code check, branch sweep.
- Every action is pinned to a commit SHA; jobs get least-privilege permissions; fork PRs never see secrets.
