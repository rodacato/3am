# ADR 0006: Real PromQL, a documented subset, honest errors

Status: accepted, 2026-10-16

## Context

Learners should practice the query language they will use, but a full PromQL engine is out of scope.

## Decision

Parse with `@prometheus-io/lezer-promql`, convert the tree to a small AST, and evaluate a documented subset (`docs/query-languages.md`) vectorized over one-minute steps. Anything outside the subset raises a typed, translated error naming the feature. The same grammar powers CodeMirror highlighting and autocomplete of metric names and label values from the case. Logs and traces use a small documented filter syntax.

## Consequences

No silently wrong answers. Dashboards are PromQL too, so every panel can be opened and edited. DuckDB-WASM for SQL over logs is deferred.
