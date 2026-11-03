# ADR-0005 — Full-scale fictional room with storage and private suites

**Date:** 2026-11-02 · **Status:** Accepted (requested by the project owner)

## Context

The first fixture (36 tables) was too small to show the problems the product exists for: large-party builds
in private rooms, parties that need several long tables, and nights when covers exceed what is on the floor and
the team pulls tables and chairs from storage. The owner supplied a reference floor plan of a large group-dining
venue to calibrate scale.

## Options considered

1. Keep 30–40 tables.
2. ~70 tables.
3. Full scale (~120 tables, ~500 seats), structure taken from the reference, every detail invented.

## Decision

Option 3. The fixture is fictional: only structural patterns are kept (11 main-floor server sections of 5–6 tables
around a service station; square 4-tops, 4-tops set as diamonds, 6–8-top rounds, 2-tops along walls; a private wing
of 10 narrow rooms in two suites whose dividers open). Geometry, numbering, names and colours are new; the reference
image is never stored in this repository.

Schema additions (human-tier change): `diamond` shape; `maxExtraChairs` per table; area `kind`, `suite`, `order`,
`spareSlots`; storage `inventory.spareTables`. Party fit may add chairs from storage. Build plans may span up to
three long tables in neighbouring rooms of one suite, and use extenders (joinable rows only), chairs and spare tables,
never beyond what is in storage. `checkTableSet` is the single legality check for a recommended set of tables.

## Consequences

Room state for the agent is larger (more input tokens per call); cost is measured per call and shown on `/evals`.
Golden scenarios and the judge calibration are tied to this fixture version.
