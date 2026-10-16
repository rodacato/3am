# ADR 0007: Generation and search run in a Web Worker

Status: accepted, 2026-10-16

## Context

Cold telemetry generation and log search take up to a second; animations must not stall.

## Decision

`src/worker/handle.ts` is the whole worker as a pure async function; `worker.ts` only adds postMessage with a versioned envelope. The client keeps a 64-entry LRU of results keyed by the request, which is safe because results are pure functions of (case, seed, mitigations, clock, request). `src/engine`, `src/telemetry` and `src/query` use no browser APIs; lint forbids `Math.random`, `Date.now` and DOM globals there.

## Consequences

The same code runs in Node for tests and the solvability check. An e2e test compares a search answered by the worker with the same search computed in Node.
