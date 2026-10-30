# ADR 0015: Calls can wait on a connection pool

Status: accepted, 2026-10-29.

## Context

Case 03 is pool exhaustion: a service runs out of database connections while the database itself is
fine. The engine had no notion of waiting for a resource, and a per-request queue simulation would
break ADR 0003's rule that a request is rebuilt from its seed alone, with no state carried between
requests.

## Decision

- **A call may declare `pool: { size, acquireTimeoutMs }`**, per caller instance, with an optional
  `configKeys.poolSize`. A component may declare `maxConnections`; the pool's effective size is
  `min(size, floor(maxConnections / caller instances))`, so scaling the caller adds no connections
  past the database's limit.
- **The pool is computed per minute, not per request.** Demand per instance follows Little's law:
  call rate × hold time ÷ instances. The call rate walks the topology from the entry rate; the hold
  time is the callee's expected duration plus `pool.holdMs`. Leaked connections (`pool.leaked`,
  floored) are used and never free.
- **Wait.** Below capacity the mean wait is Sakasegawa's M/M/c approximation,
  `hold × ρ^(√(2(c+1)) − 1) / (c(1 − ρ))`, capped at the acquire timeout, where `c` is the free
  connections and `ρ` the utilization: zero in practice until ρ is near 1. Each call draws a wait from
  that exponential, truncated below the timeout. Above capacity, a share `1 − 1/ρ` waits the full
  timeout and fails as `pool_timeout` ("could not acquire connection in n ms"); the rest wait as if
  ρ were 1.
- **Through the one simulator.** Waits and pool timeouts are drawn inside `simulateRequest`, so
  client metrics, the `poolTimeout` log trigger and client spans count the same calls. The OTel
  connection metrics, Prometheus-named: `db_client_connections_usage{state}`, `_max` and
  `_pending_requests` (gauges, summed across instances), `_wait_time_seconds` and `_use_time_seconds`
  (histograms). A call that never got a connection never reaches the callee's load.
- **`calls.perRequest`** multiplies how often a call is made per visit, for cache-miss amplification.
  It and the `pool.*` params name the call they change with `call`.

## Alternatives

- A queue per request: realistic tails, but every request would depend on the ones before it.
- Erlang C: exact for M/M/c, needs a loop per minute and gives the same shape the approximation does.
- Load-dependent latency on the database: not what pool exhaustion is, and planned for case 05.

## Consequences

Cases without a pool produce identical telemetry. Wait does not feed back: queued calls do not hold
connections longer, and a slow database lengthens hold time only through its declared latency.
A leak applies equally to every instance, so new instances from a scale-up start leaked too.
