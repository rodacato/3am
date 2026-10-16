# ADR 0002: Cases are emulated in the browser

Status: accepted, 2026-10-16

## Context

The course is hosted on GitHub Pages and inside a Dojo iframe; there is no backend.

## Decision

The engine runs entirely client-side. Each case is a TypeScript data module loaded on demand through `import.meta.glob` (`src/content/registry.ts`), one chunk per case, never the whole catalog. Case text lives in per-locale JSON next to the case.

## Consequences

Adding a case is adding a folder. Nothing about a case is secret from a determined reader of the bundle; this is a learning tool, not an exam.
