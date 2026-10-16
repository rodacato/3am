# ADR 0004: The clock moves only when the reader acts

Status: accepted, 2026-10-16

## Context

Real-time waiting would make the course about patience; the brief wants every look to cost something.

## Decision

The incident clock is integer minutes since 00:00 of the case date. It advances only by the time cost of a query, a mitigation, watching it land, or a status update, all defined per case. Queries never see data after the clock. Failed queries cost nothing.

## Consequences

Pace is the reader's. Budget overruns are measured, not punished: past sunrise the case stays open and the sky says so.
