# ADR 0010: Versioned localStorage

Status: accepted, 2026-10-16

## Context

Progress must survive reloads in standalone mode without a backend.

## Decision

One localStorage key holds preferences, progress per case and the in-progress session (machine snapshot, board, postmortem draft, status draft). The shape carries a version and an ordered list of migrations run on load; an unknown future version starts clean. Storage failures (full, blocked in an iframe) are swallowed: the course still runs. IndexedDB is reserved for future session replays.

## Consequences

Query results are not stored; they are recomputed deterministically when a receipt is reopened.
