# Adaptive Floor Planner

[![ci](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/ci.yml)
[![e2e](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/e2e.yml/badge.svg)](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/e2e.yml)
[![codeql](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/codeql.yml/badge.svg)](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/codeql.yml)
[![secret-scan](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/secret-scan.yml)
[![evals-live](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/evals-live.yml/badge.svg)](https://github.com/yeezick/resy-adaptive-floor-planner/actions/workflows/evals-live.yml)

> **Concept prototype by Erick Manrique — not affiliated with, endorsed by, or using data from Resy or American Express.**
> All restaurant data in this repository is fictional.

**Host tools today plan the layout ahead of time. This plans tonight's layout from tonight's book.**

**Live demo:** https://adaptive-floor-planner-production.up.railway.app (fictional data; each scenario below opens from
that URL, e.g. [`/?scenario=party-22-agent`](https://adaptive-floor-planner-production.up.railway.app/?scenario=party-22-agent)).

Give it tonight's reservations, the base floor plan and what is in storage. It proposes tonight's layout as a list of
changes — tables pushed together, dividers opened, extenders, chairs and spare tables pulled from storage — with an
ordered crew build list, time windows and a reason for every choice. When something can't fit, it says why and keeps
the best partial plan. A person edits the proposal in the same floor-plan editor and applies it.

During service it ranks where a walk-in can sit and how soon, using where each table is in its meal (seated → drinks →
apps → entrées → dessert → check). It **recommends; it never seats anyone.** Everything the agent can do has a manual
control.

In the app, every AI feature appears under one name: the **AI Planner**. That covers the assistant panel, request
triage, the in-request chat and the "What the AI Planner did" column on the activity log. The product itself is the
Adaptive Floor Planner.

## Large-party requests: capacity fit and the cost of saying yes

Parties above the online cap of 8 reach a request inbox from three sources: the **Resy app**'s request form, an
**AI agent** (a chat app or MCP client) booking for a guest, and a **walk-in at the host stand** (the host types it).
Each request gets an AI triage (real vs junk, plus a two-line needs overview) and a **capacity fit** from the
planner: the night's book is planned with and without the party, and it fits only if every existing booking keeps
its seats. Tables come from the deterministic capacity check; the AI reads the request and can't pick or add tables.

**Readiness.** Each table in the proposed join turns green on the floor and gets a bubble, estimated from its meal
phase. A request for now (it arrives within one 90-minute turn of the floor clock, or its hold has begun) shows live
minutes: "now", or a red "~Xm" until free; the pill reads "capacity fit ✓ · Ready" or "capacity fit ✓ · ready to set
up in ~X min". A later request is projected to its hold start: will each table be free when the hold begins? The
sheet lists "free by 5:00 PM" or "busy until ~5:20 PM (est.)" per table, the floor shows "free" or a red "~5:20 PM",
and the pill reads "capacity fit ✓ · Ready" or "capacity fit ✓ · ready to set up at ~5:20 PM".

**Impacts of saying yes**, as two columns:

- **Pros:** +N covers in one booking; no reservations moved (when no other planned large party changes tables);
  aisle clear for a wheelchair or stroller, shown only when the party asked for that.
- **Cons:** tables held from–to; ~N covers lost over one turn (est.); which server section's load rises; any other
  large party that moves to other tables.

Beneath them, the card weighs yes against no, in covers (a negative net is shown as it is):

- **Accept:** +N covers (the party) − M covers lost to the hold (est.) = net. The hold starts one 90-minute turn
  before the build, and covers lost = seats × minutes held ÷ 90.
- **Decline:** 0, and the request leaves Resy.
- **Crew: build time ~X min (est.):** crew minutes per step from
  [`fixtures/crew/build-minutes.json`](fixtures/crew/build-minutes.json): 3 per floor table, 3 per extender, 4 per
  spare table from storage, 5 per divider opened, 1 per 4 chairs carried, and never under 10. The same constants set
  the crew list's time windows. Labour cost stays out of the prototype.

The actions, in order: **Accept · Decline** (with a reason) **· Message guest · Discuss** (the AI affordance, a
sparkle in the accent colour; it jumps to the in-request chat). Every chat change is also a manual control.

Times a manager reads are 12-hour AM/PM ("build by 6:00 PM", "held 5:00–6:30 PM"). The domain, the API and the
evals keep 24-hour "HH:MM"; the screen converts it (`clock12` / `times12` in `src/domain/time.ts`), and an e2e check
fails if a 24-hour time reaches any scenario's screen.

Table numbers never carry the fixtures' `T` prefix in anything a person reads ("Combine tables 72, 73 and 74 into an
11-top; bring 2 tables and 6 chairs from storage."). Elapsed time on seated tables is estimated from meal phase and
is labelled "est.".

## Scenarios (deep links)

The header's **Scenarios** menu opens a named demo state in one click. Each one has a stable URL (on the
[live demo](https://adaptive-floor-planner-production.up.railway.app) or locally) and opens from
fixtures, with AI answers replayed from recordings in `fixtures/scenarios/`, so no model is called:

| URL                            | Opens                                                         |
| ------------------------------ | ------------------------------------------------------------- |
| `/?scenario=party-22-agent`    | AI-agent request for 22, capacity fit + cost sheet open       |
| `/?scenario=party-22-accepted` | the 22-top accepted: tonight's layout and crew build list     |
| `/?scenario=walkin-8-peak`     | walk-in of 8 at 7:10 PM, AI Planner open with ranked options  |
| `/?scenario=request-chat`      | the in-request chat mid-conversation ("between tables 30–50") |
| `/?scenario=activity-log`      | the activity log with rated rows and a request-chat turn      |

## In-request chat

Inside a request, the manager can type a change that applies to that request only ("headcount is now 26", "can
we push it to 7:00 PM?"). Haiku turns the message into constraints (table range, headcount, time, needs, crew
notes); the planner re-runs the capacity fit; the card shows the new option and its cost. The model never names a
table, and every number it sets must appear in the manager's message. Each constraint is also a control on the
sheet, and every turn is logged in the activity log (the message as a hash). Evals:
`evals/request-chat/golden.jsonl` (recorded answers replayed in CI, including two cases where a headcount
must not move the time: "make it 20 people" and "a table for 8"); `pnpm evals:request-chat:live` re-records
(`-- --only <id,id>` for just those).

## Feedback on the AI Planner

Every activity-log row has 👍 / 👎. A click saves at once, as one entry per row per manager; clicking the other thumb
updates that same entry. Either thumb opens an optional note box, and a note is appended to the same entry. Notes are
kept as a hash + length only, the same rule as guest text. A **Feedback** filter shows any, 👍, 👎 or unrated rows.
Each record links to its activity-log row id (`src/domain/feedback.ts`). In the public demo it is saved in the
browser. This is the data a later tuning loop would read; nothing in the prototype trains on it.

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
cp .env.example .env   # add an API key to use the AI Planner; everything else works without one
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
