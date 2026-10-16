# ADR 0008: The incident lifecycle is an XState machine

Status: accepted, 2026-10-16

## Context

Phases, guards and the clock were spreading across components.

## Decision

`src/engine/incident-machine.ts` models briefing, paged, investigating, mitigating, stable, postmortem and debrief. Queries, mitigations, observed outcomes and status updates are events; status updates are only accepted once a stakeholder has asked. Telemetry-dependent facts (did the alert clear?) are computed by the engine and carried in events, so the machine stays pure.

## Consequences

The machine snapshot is what gets persisted. Transitions are tested for every case.
