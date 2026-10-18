# Query languages on the desk

Every query costs simulated minutes. A query that fails to parse costs nothing.

## PromQL subset

Metrics are queried with real PromQL, parsed by the official Prometheus grammar (`@prometheus-io/lezer-promql`) and evaluated by `src/query/promql/evaluate.ts` against the simulated series. Results use one-minute steps over the last 90 minutes up to the clock.

Supported:

| Feature | Example |
| --- | --- |
| Instant selectors with label matchers `=`, `!=`, `=~`, `!~` | `http_client_requests_total{service="checkout-api", outcome=~"timeout\|error"}` |
| Range selectors (`s`, `m`, `h`) inside `rate` / `increase`, in whole minutes (series are one sample per minute) | `rate(http_server_requests_total[5m])` |
| `rate`, `increase` | `increase(http_client_requests_total{outcome="timeout"}[10m])` |
| `histogram_quantile` over `_bucket` series | `histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket{service="checkout-api"}[5m])))` |
| Aggregations `sum`, `avg`, `min`, `max`, `count`, with `by (…)` or `without (…)` | `sum by (status_class) (rate(http_server_requests_total[5m]))` |
| Arithmetic `+ - * / % ^` between scalars and vectors, one-to-one matching on all labels except the name | `sum(rate(...{status_class="5xx"}[5m])) / sum(rate(...[5m]))` |
| Comparisons `== != > < >= <=` as filters (vector with scalar or vector) | `process_cpu_utilization_ratio > 0.8` |
| Unary minus, parentheses, number literals | `-(1 - x)` |

Not supported, and answered with an honest error rather than a guess: `offset`, `@`, subqueries, `bool`, `on` / `ignoring` / `group_left` / `group_right`, `and` / `or` / `unless`, every other function and aggregation (`topk`, `quantile`, `predict_linear`, `*_over_time`, …), string literals as expressions, comparisons between two scalars.

`rate` and `increase` take the difference across the window without Prometheus' boundary extrapolation; counters in the simulation never reset.

### Metrics in every case

Named after the OpenTelemetry semantic conventions as Prometheus exports them. Service names live in the `service` label.

- `http_server_request_duration_seconds_bucket|_count|_sum{service, http_route, le}`
- `http_server_requests_total{service, http_route, status_class}`
- `http_client_request_duration_seconds_bucket|_count|_sum{service, peer_service, le}`: one observation per attempt
- `http_client_requests_total{service, peer_service, outcome}`: `ok`, `error`, `timeout`
- `process_cpu_utilization_ratio{service}`, `process_memory_usage_bytes{service}`

External dependencies have no server-side series: you only see them through client metrics and spans, as in real life.

## Log filter

Space-separated terms, all of which must match. Default window: the last 30 minutes.

| Term | Meaning |
| --- | --- |
| `service:checkout-api` | only this service (repeat for several) |
| `level:warn` / `level:warn+` | exactly this severity / this severity or worse |
| `"timed out"` or `retry` | body contains the text, case-insensitive |
| `-healthz` | body does not contain the text |
| `trace:7f3a` | trace id starts with |
| `since:45m` | window ending at the clock |
| `from:03:00 to:03:20` | explicit window |

## Trace filter

| Term | Meaning |
| --- | --- |
| `service:checkout-api` | traces with a span in this service |
| `operation:"POST /orders"` | traces with a span of this name |
| `min:4s` / `min:800ms` | the matching span lasted at least this long |
| `status:error` | the matching span failed |
| `since:15m`, `from:` / `to:` | window (default: last 15 minutes) |

Results list the slowest 150 traces. Opening one costs a minute.
