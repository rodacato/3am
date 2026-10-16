# ADR 0003: One request simulator drives every signal

Status: accepted, 2026-10-16

## Context

Metrics, logs and traces must agree with each other, or the investigation teaches the wrong lesson.

## Decision

`src/telemetry/requests.ts` simulates individual requests per minute (up to 400 samples, scaled to the real rate) through the case topology, with timeouts, retries and per-minute component state. Histograms count those requests, logs are emitted from their events, traces are the same requests with spans. A trace ref (minute:index) rebuilds a trace exactly, so nothing is stored. Aggregates are cached per minute and shared between what-if mitigation timelines that have not diverged yet.

## Consequences

Signal agreement is a property of the design and is tested to the count. Logs above the sample cap are a sample; at night traffic sits under the cap. Cold queries over hours of history take about a second, hence the worker (ADR 0007).
