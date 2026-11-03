# ADR-0004 — Spend caps: daily demo budget and per-run eval budget

**Date:** 2026-11-02 · **Status:** Accepted

## Context

The demo is public and calls a paid API.

## Decision

Every call's cost is computed from the response `usage` and a dated price table (`src/server/pricing.ts`).
Demo traffic stops at `DAILY_BUDGET_USD` (429 with a "demo budget reached" message); per-IP rate limit
`RATE_LIMIT_PER_MIN`; 500-character input cap. A live eval run aborts once `EVAL_RUN_BUDGET_USD` (default 5) is spent.

## Consequences

Cost and latency are measured, not estimated, and roll up onto `/evals`.
