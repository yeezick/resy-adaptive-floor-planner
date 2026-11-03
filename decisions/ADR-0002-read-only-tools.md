# ADR-0002 — Agent tools are read-only; a person applies every change

**Date:** 2026-11-02 · **Status:** Accepted

## Context

Operators distrust software that seats guests on its own. The product rule is "recommend, never auto-seat",
and every agent capability must have a manual control.

## Options considered

1. Agent tools that mutate room state (seat, combine) behind a confirmation.
2. Read-only tools; the agent returns proposals and the UI offers an Apply button.

## Decision

Option 2. Tools: `get_room_state`, `find_tables_for_party`, `estimate_free_time`, `propose_combine`. Each input is a
Zod schema sent with `strict: true` and re-validated on the server. A validator rejects any recommendation naming a
table that is not in room state.

## Consequences

The agent cannot change the room. Manual combine/split in the UI uses the same domain functions as the proposals.
