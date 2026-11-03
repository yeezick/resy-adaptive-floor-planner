# ADR-0003 — Deterministic assertions gate CI; the LLM judge never does

**Date:** 2026-11-02 · **Status:** Accepted

## Context

Live model calls are nondeterministic and cost money. CI must be reproducible and free.

## Decision

CI replays recorded agent transcripts through code assertions (tables exist, capacity, constraints, phase timing,
no reserved conflict, required tools called, no invented numbers). Live runs and the LLM judge (a different model
than the agent) run in an advisory workflow. The judge's verdicts are shown as trusted only once its TPR and TNR
against human labels clear a stated threshold.

## Consequences

A behavior change needs re-recorded transcripts to update the gate. Judge calibration is stale whenever the prompt
version or a model changes.
