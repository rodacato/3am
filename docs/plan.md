# 3 AM: plan (Step 2)

Step 1 shipped the engine, the telemetry, case 01 in two locales and the desk. This plan fixes the contracts the remaining seven cases will build on, then orders the work. Decisions are recorded in [docs/adr](adr/README.md); this page says what each contract is and what changes.

## Contracts

**Case schema** (`src/engine/case-schema.ts`, Zod, cross-reference validation). A case is one folder: `case.ts` plus `locales/<code>.json`. Fields: `traffic` (entry, daily curve, wobble); `components` (kind, instrumented, instances, latency and slow tail, error ratio, CPU, memory, `calls` with timeout, attempts and the config keys that override them); `config` baseline; `changes` (deploy, config, flag); `effects` (the causal graph: a parameter of a component set, added or multiplied from a minute, with ramp, growth, `removedBy` and `resetBy` mitigations); `logs` templates (rate-based or triggered by attempt timeout, retry, server error, slow request); `alert`; `page`; `tools` (costs, PromQL dashboards, runbooks); `mitigations` (revert change, restart, scale; evidence they destroy); `stakeholderPrompts`; `factors` with required evidence groups; `distractorFactors`; `causalChain`; `solution` for the solvability check; `readNext`. Red herrings are ordinary effects and changes that no factor needs.
Additions, each with its first case: `effects.jitterMin` so the seed moves red herrings, not just noise (02); a connection `pool` per call with queueing wait (03); `historyFrom` in days with coarser old resolution (04); load-dependent latency so retries feed back on the callee (05); an `expire` effect and mitigations that can fail (06); an `instrumentation` override chosen by the reader (07).

**Telemetry generators** (`src/telemetry`), all pure functions of (case, seed, applied mitigations, minute): `simulateRequest` → spans and call records; `aggregateMinute` → server and client histograms, outcome counts, bad requests; `seriesValues` → Prometheus-named series (cumulative counters, gauges) for OTel metrics; `logsInMinute` → `LogRecord`s with severity and trace links; `searchTraces` / `traceByRef`; `pulseAt` → skyline health; `exportIncident` → OTLP/JSON. Contract: metrics, logs and traces of a minute are built from the same requests, and tests hold them equal to the count.

**PromQL subset** (`docs/query-languages.md`): selectors with `= != =~ !~`, ranges, `rate`, `increase`, `histogram_quantile`, `sum avg min max count` with `by`/`without`, arithmetic, filter comparisons. Everything else is a typed, translated error. Planned only if a case needs it: `max_over_time` (04), `topk` (05). Logs and traces keep their filter syntax; DuckDB stays deferred.

**Worker messages** (`src/worker/protocol.ts`, envelope `{ v: 1, id, body }`): `tool` (any `ToolRequest` at a clock), `pulse`, `observe` (when does a mitigation clear the alert), `vocabulary` (autocomplete), `export` (OTLP). Replies `{ ok, result | message }`. `handle.ts` is the same function in Node; the client keeps a 64-entry LRU.

**Incident machine** (`src/engine/incident-machine.ts`, XState): `briefing → paged → investigating ⇄ mitigating → stable → postmortem → debrief`. Events: `START`, `ACK`, `QUERY_DONE` (advances the clock by its cost), `MITIGATE`, `MITIGATION_OBSERVED` (clears or charges watching time), `SEND_STATUS` (guarded: only once asked), `WRITE_POSTMORTEM`, `SUBMIT_POSTMORTEM`. Case 08 adds a parallel `comms` region for several stakeholders with deadlines; unanswered prompts appear in the debrief.

**Persisted state** (`src/ui/persistence.ts`, localStorage key `3am`, migrations on load): `{ version: 1, preferences: { locale, sound }, progress: { [caseId]: { completed, runs, bestMitigationMin } }, sessions: { [caseId]: { seed, machine snapshot, board, postmortem, statusDraft } } }`. Version 2 arrives with case 07 to store the reader's instrumentation design.

**Course manifest and host bridge.** `public/scroll.json` follows Dojo's scroll protocol v0 (`@dojo/shared`): `id: "3am"`, semver `version`, `protocol: 0`, `entry: "index.html"`, `locales: ["en", "es-MX"]`, localized `title` and `description`, `units` = the eight case ids, `capabilities: ["progress"]`. The embedded `HostBridge` adapter speaks the protocol's envelope `{ dojo: "scroll", v: 0 }` with exact-origin `postMessage` and nonce checks: `hello` → host `init` (session, locale, theme, previous progress, capabilities); `progress` with `unitId` on case start and with `completed: true` plus a compact state (under 64 KB) on debrief; `complete` after the last case; `resize`; host `setLocale` and `setTheme`. Postmortem and status review by Dojo's sensei is not in v0: we propose an `evaluate` capability (scroll `evaluate { id, unitId, kind, locale, text, rubric }` → host `evaluation { id, verdict, notes }`), sent only after a case is filed. Until Dojo adopts it, the standalone rubric is the review.

**Folder layout**: `src/engine` (schema, state, clock, tools, machine, rubric, scoring, solvability), `src/telemetry` (simulator, metrics, logs, traces, pulse, OTLP), `src/query` (PromQL, filters), `src/worker`, `src/content` (cases, sources), `src/i18n`, `src/host` (manifest, bridge, adapters), `src/ui` (desk, window, board, monitor, overlays), `scripts` (checks, demo recording), `tests`, `e2e`, `docs`.

## Phases

Each phase ends with screenshots in both locales, the e2e flow for its case, and a written self-critique against the brief and the banned list.

1. **Hardening.** The debrief notes unanswered stakeholders; the seed jitters red herrings; the dashboard tool stops being equal tiles; hypothesis cards stay clear of building labels; first CI run and Pages deploy.
2. **Host.** Manifest, embedded adapter, a conformance run with Dojo's `scroll-conformance` package, and the `evaluate` proposal opened in Dojo.
3. **Case 02, "What changed?"** The 02:40 deploy explains everything; the change log becomes the first move.
4. **Case 03, red herrings.** Connection pool exhaustion hidden behind a loud cache.
5. **Case 04, slow burn.** A memory leak over days and a query that slowed as data grew; a restart clears the symptom and the heap evidence.
6. **Case 05, cascade.** A slow dependency and retries take down three services.
7. **Case 06, multiple factors.** An expired certificate and a failover nobody had tested.
8. **Case 07, day shift.** Design alerts, dashboards, SLOs and error budgets; the next night shows only what you instrumented: unlit buildings for the rest.
9. **Case 08, finale.** A major incident with several stakeholders and communication deadlines.
10. **Polish.** Accessibility pass, performance budget (initial bundle under 300 kB gzipped, smooth with four live charts), sound review, the README demo with a full board in the first five seconds.
