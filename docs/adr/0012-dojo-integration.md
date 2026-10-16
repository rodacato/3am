# ADR 0012: Align with Dojo's scroll protocol

Status: accepted, 2026-10-16

## Context

Dojo already ships an embedding contract, scroll protocol v0, in `@dojo/shared` (packages/shared/src/scroll-protocol.ts at dojo@1bf11b2): manifest, hello/init handshake with nonce and origin checks, progress, locale and theme. It has no message for evaluating written work. Pattern Circuit's course-kit v1 is a different, older draft.

## Decision

3 AM talks to its host only through the `HostBridge` port (`src/host/bridge.ts`). The standalone adapter ships now. The embedded adapter will implement scroll protocol v0; postmortem evaluation will be proposed to Dojo as a capability extension rather than invented here.

## Consequences

No shared package exists to import yet. The Step 2 plan details the manifest and message mapping.
