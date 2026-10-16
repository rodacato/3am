# ADR 0009: Libraries and why

Status: accepted, 2026-10-16

## Context

Every dependency had to earn its place; versions were checked on 2026-10-15.

## Decision

React 19.3 and Vite 8.3 (MIT). TypeScript 6.0.3, not 7.0: typescript-eslint 8.71 supports TypeScript below 6.1. Zod 4.6 for case and storage shapes. XState 5.33 and @xstate/react 6.1. uPlot 1.6.32 for every time series, restyled (MIT; stable, last release 2025). CodeMirror 6 with @prometheus-io/lezer-promql 0.313 (Apache-2.0). TanStack Virtual 3.14 for log lists. elkjs 0.12 (EPL-2.0 or GPL-3.0; used unmodified as a dependency) for the debrief graph, lazy-loaded because it is 1.4 MB. simplex-noise 4.0 and pure-rand 8.4 for seeded noise. Fonts self-hosted through Fontsource (OFL). Vitest 5 and Playwright 1.64 for tests.

## Consequences

Not used: Framer Motion (CSS transitions covered every UI transition, so it was removed), Rive (the scene works without it), PixiJS, d3 (uPlot replaced it for charts), DuckDB-WASM (deferred).
