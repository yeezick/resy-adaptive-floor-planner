# ADR-0009 — Floor edits by conversation

**Date:** 2026-11-05 · **Status:** Accepted

## Context

Hosts asked to change tonight's floor in words — "move 56 into the Library, move 63–66 into the Garden Room, 2 rows
of 4 and 5" — and the chat could only say it couldn't. Letting a model place tables would mean model-written
positions, seat counts and aisle widths: exactly what the planner must never take from a model. Aisle data is also
recorded per joined pair of table ids, so a table moved to another room would silently keep its old measurements.

## Decision

**The model names operations; code does everything else.** The request chat (and Shift setup's "Tell the AI") may
return `ops` — move · swap · join · split · from_storage · to_storage · arrange_rows over table references by number,
range, description or room — plus `rooms` / `oneRoom` constraints. No coordinates, seats, sections or aisles; table
numbers only as typed. The output stays flat (sentinels and enums, no new union-typed fields). A pure engine
(`proposeLayoutEdit`, `src/domain/layoutOps.ts`) resolves the references, places tables, checks R1–R11 and rejects the
whole proposal with every reason, then re-plans. A proposal changes nothing until Apply; Apply saves a new one-day
layout for that night from the layout in use (the base is never changed); Undo removes it.

- **Where a table may stand: listed spots.** A fictional venue fixture (`fixtures/spots/`) lists, per room, extra
  spots (the Garden Room back row, a Library round spot, one spare spot per storage slot) with their attributes,
  extra-chair room, row and the measured aisle between neighbouring spots. A table's home position on the base layout
  is also a spot once that table has left. Moves fill row spots left to right first, spare spots last; filling a spare
  spot uses one of the room's spare slots.
- **Clearance is decided by position, never by a new Table field** (`clearanceForLayout`): a table on a listed spot
  uses the spot pair's measurement (none → unmeasured, which fails); a table on another table's vacated home uses
  that table's values; anything else keeps today's value by id. Crew-plan layouts (tables slid along their rows) and
  editor-edited layouts therefore plan exactly as before (tested).
- **Move time.** A live night (clock at or after service start) checks a table is free now; a planning night checks
  it will be free by service start.
- **R8 scope: parties of 7+.** The engine re-plans the night's book on the edited floor and rejects the edit if any
  large party placed before would lose its table. Smaller parties aren't table-assigned by the planner, so they are not
  checked.
- **Crew estimate: ~3 minutes per table carried** (moved, swapped, to or from storage), labelled "est."; joinability
  changes take no carrying.
- **Set-aside tables.** Taking a joinable rectangle out returns it to storage (the planner can use it as a spare
  4-top when it seats 4). Other shapes (diamonds, rounds) are "set aside for tonight" with no change to storage.
- **Dividers** stay a property of each party's plan (which rooms it may use), not saved floor state.
- **Refusals are code.** The bar, walls and the service station; the base layout and deleting tables; accepting or
  confirming — answered on the device with one plain sentence. A message mixing a floor change with "accept it" gets
  the proposal and the refusal.

## Consequences

The manager can reshape tonight's floor by talking, and every number on screen still comes from the planner. The
venue must list spots for a room before tables can move into it; a room with none gets a plain "no free spot".
Evals cover every rule deterministically and replay recorded model answers through the same code
(`evals/floor-chat/`).
