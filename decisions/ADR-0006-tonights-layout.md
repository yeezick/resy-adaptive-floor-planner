# ADR-0006 — Generate tonight's layout from tonight's book

**Date:** 2026-11-02 · **Status:** Accepted

## Context

Floor plans in host tools are configuration: someone builds named layouts and preset combinations ahead of time. On a
night with many large parties, the team still works out tonight's layout by hand from the book. That is the gap this
prototype targets.

## Decision

`generateTonight(room, from, to)` (pure, `src/domain/tonight.ts`) turns the book + base layout + storage into:
a one-day layout variant (first builds applied: rows pushed together, spare tables placed at row ends, joins), a change
list, an ordered crew list with time windows (rebuilds include splitting the earlier party), a reason per party, and
plain "can't fit X because Y" for anything infeasible, keeping the best partial plan. Live state is respected: a seated
table is used only if it frees before the build starts, a held table only for its own party or after it leaves.
Layouts are named: a base layout plus one-day variants linked to a date and shift. The floor-plan editor is the manual
twin: anything the generator proposes can be made or changed by hand. The agent's `plan_builds` tool returns this
proposal. Tables gain `minSeats`; attributes include aisle clearance.

## Consequences

The planner proposes and explains; a person applies. Build-time estimates are rough and stated as such. Storage is held
for the whole window (not returned when a party leaves) — conservative by design.
