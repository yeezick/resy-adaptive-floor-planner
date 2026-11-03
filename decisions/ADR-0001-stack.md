# ADR-0001 — One Node service: Vite + React + TypeScript client, Express server

**Date:** 2026-11-02 · **Status:** Accepted

## Context

A public concept prototype with an interactive floor plan, an agent chat that calls the Anthropic API, and an
`/evals` page. The API key must never reach the browser. Deployed as a single Railway service.

## Options considered

1. Next.js (SSR + API routes) — more framework than a canvas-style page needs.
2. Vite + React SPA served by Express — static client, small server, plain middleware for rate and cost caps.
3. Separate client and API services — two deploys for no benefit at this size.

## Decision

Option 2. Express serves `dist/client` and `/api/*`. Room logic is pure TypeScript in `src/domain/`, shared by
the UI, the agent's tools and the evals. pnpm, TypeScript strict, Zod at every boundary, Vitest.

## Consequences

One build, one deploy, one health check (`/healthz`). The server bundle is built with Vite's SSR build.
