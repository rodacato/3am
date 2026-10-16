# ADR 0005: OpenTelemetry data model and OTLP export

Status: accepted, 2026-10-16

## Context

Readers should meet the shapes they will see at work, and be able to take the night into real tools.

## Decision

Internal telemetry follows the OpenTelemetry model: resources with `service.name`, spans with trace/span/parent ids, kind and status, log records with severity number and text, metrics named after the semantic conventions as Prometheus exports them. The debrief's "Take the case home" exports traces, logs and metrics as OTLP/JSON (`src/telemetry/otlp.ts`): all slow or failed requests plus a 1-in-25 sample of healthy ones.

## Consequences

Files load into an OpenTelemetry Collector and from there into Jaeger, Tempo or Loki (README). Metrics keep their 2026 timestamps, which some backends refuse without backfill.
