import type { Component } from '../engine/case-schema';
import { acquire } from '../engine/pool';
import { createRng, type Rng } from '../engine/random';
import { nightKey, systemStateAt, type Scenario, type SystemState } from '../engine/state';
import { minuteToMs } from '../engine/time';
import type { Span } from './otel';

// Simulated requests are the single source of truth: metrics count them, logs narrate them, traces show them.

export const SAMPLE_CAP = 400;
export const LATENCY_BUCKETS_S = [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 7.5, 10, 15] as const;
const RETRY_BACKOFF_MS = 25;

export type CallOutcome = 'ok' | 'error' | 'timeout' | 'pool_timeout';
// poolWaitMs is null for calls without a pool; poolHoldMs is null when no connection was ever handed out.
export type CallRecord = {
  callId: string; attempt: number; maxAttempts: number; startMs: number; durationMs: number; timeoutMs: number; outcome: CallOutcome; spanId: string;
  poolWaitMs: number | null; poolHoldMs: number | null;
};
export type ServerRecord = { component: string; startMs: number; durationMs: number; error: boolean; spanId: string };
export type RequestRecord = {
  minute: number;
  index: number;
  traceId: string;
  startMs: number;
  durationMs: number;
  error: boolean;
  servers: ServerRecord[];
  calls: CallRecord[];
  spans: Span[];
};

export type Histogram = { buckets: number[]; sum: number; count: number };
export type MinuteAggregate = {
  minute: number;
  scale: number;
  sampled: number;
  server: Record<string, { errors: number; histogram: Histogram }>;
  client: Record<string, { outcomes: Record<CallOutcome, number>; histogram: Histogram }>;
  pools: Record<string, { wait: Histogram; use: Histogram; waitMsTotal: number }>;
  badRequests: number;
};

export function hasServerSpans(component: Component): boolean {
  return component.kind === 'service' && component.instrumented;
}

export function sampleCount(state: SystemState): { sampled: number; scale: number } {
  const expected = state.entryRps * 60;
  const sampled = Math.max(1, Math.min(SAMPLE_CAP, Math.round(expected)));
  return { sampled, scale: expected / sampled };
}

type Visit = { endMs: number; error: boolean };

export function simulateRequest(s: Scenario, minute: number, index: number, withSpans: boolean): RequestRecord {
  const state = systemStateAt(s, minute);
  const rng = createRng(s.data.id, s.seed, 'request', minute, index);
  const startMs = minuteToMs(s.data.date, minute) + rng.next() * 60_000;
  const record: RequestRecord = { minute, index, traceId: rng.hex(32), startMs, durationMs: 0, error: false, servers: [], calls: [], spans: [] };
  const components = new Map(s.data.components.map((c) => [c.id, c]));

  const visit = (componentId: string, start: number, parentSpanId: string | null): Visit => {
    const component = components.get(componentId);
    const live = state.components.get(componentId);
    if (!component || !live) throw new Error(`unknown component ${componentId}`);
    const spanId = rng.hex(16);
    const own = rng.chance(live.tail.ratio)
      ? rng.lognormal(live.tail.medianMs, live.tail.sigma)
      : rng.lognormal(live.latency.medianMs, live.latency.sigma);
    let cursor = start + own * 0.6;
    let error = false;

    for (const call of component.calls) {
      const callState = state.calls.get(call.id);
      if (!callState) continue;
      for (let n = repetitions(callState.perRequest, rng); n > 0; n--) {
        for (let attempt = 1; attempt <= callState.maxAttempts; attempt++) {
          const clientSpanId = rng.hex(16);
          const pool = callState.pool;
          const acquired = pool ? acquire(pool, rng) : null;
          const base = { callId: call.id, attempt, maxAttempts: callState.maxAttempts, startMs: cursor, timeoutMs: callState.timeoutMs, spanId: clientSpanId, poolWaitMs: acquired?.waitMs ?? null };
          let outcome: CallOutcome;
          let end: number;
          if (acquired?.timedOut) {
            outcome = 'pool_timeout';
            end = cursor + acquired.waitMs;
            record.calls.push({ ...base, durationMs: end - cursor, outcome, poolHoldMs: null });
          } else {
            const start = cursor + (acquired?.waitMs ?? 0);
            const callee = visit(call.to, start + 0.4, hasServerSpans(components.get(call.to) as Component) ? clientSpanId : null);
            outcome = callee.endMs - start > callState.timeoutMs ? 'timeout' : callee.error ? 'error' : 'ok';
            end = outcome === 'timeout' ? start + callState.timeoutMs : callee.endMs + 0.4;
            record.calls.push({ ...base, durationMs: end - cursor, outcome, poolHoldMs: pool ? end - start + pool.extraHoldMs : null });
          }
          if (withSpans) record.spans.push(clientSpan(record.traceId, clientSpanId, spanId, component.id, call.to, call.operation, cursor, end, attempt, outcome, callState.timeoutMs, pool && acquired ? { waitMs: acquired.waitMs, acquireTimeoutMs: pool.acquireTimeoutMs } : null));
          cursor = end;
          if (outcome === 'ok') break;
          if (attempt === callState.maxAttempts) error = true;
          else cursor += RETRY_BACKOFF_MS * attempt;
        }
      }
    }
    if (rng.chance(live.errorRatio)) error = true;
    const endMs = cursor + own * 0.4;
    if (hasServerSpans(component)) {
      record.servers.push({ component: component.id, startMs: start, durationMs: endMs - start, error, spanId });
      if (withSpans) record.spans.push(serverSpan(record.traceId, spanId, parentSpanId, component, start, endMs, error));
    }
    return { endMs, error };
  };

  const root = visit(s.data.traffic.entry, startMs, null);
  record.durationMs = root.endMs - startMs;
  record.error = root.error;
  record.spans.sort((a, b) => a.startMs - b.startMs);
  return record;
}

function serverSpan(traceId: string, spanId: string, parentSpanId: string | null, component: Component, start: number, end: number, error: boolean): Span {
  return {
    traceId, spanId, parentSpanId, name: component.operation, kind: 'SERVER', service: component.id, startMs: start, endMs: end,
    status: error ? { code: 'ERROR', message: 'internal error' } : { code: 'UNSET' },
    attributes: { 'http.route': component.operation, 'http.response.status_code': error ? 500 : 200 },
    events: [],
  };
}

function repetitions(perRequest: number, rng: Rng): number {
  const whole = Math.floor(perRequest);
  return perRequest > whole && rng.chance(perRequest - whole) ? whole + 1 : whole;
}

function failureMessage(outcome: CallOutcome, timeoutMs: number, acquireTimeoutMs: number): string {
  if (outcome === 'timeout') return `timeout after ${timeoutMs}ms`;
  if (outcome === 'pool_timeout') return `could not acquire connection in ${acquireTimeoutMs} ms`;
  return 'upstream error';
}

function clientSpan(traceId: string, spanId: string, parentSpanId: string, service: string, peer: string, name: string, start: number, end: number, attempt: number, outcome: CallOutcome, timeoutMs: number, pool: { waitMs: number; acquireTimeoutMs: number } | null): Span {
  return {
    traceId, spanId, parentSpanId, name, kind: 'CLIENT', service, startMs: start, endMs: end,
    status: outcome === 'ok' ? { code: 'UNSET' } : { code: 'ERROR', message: failureMessage(outcome, timeoutMs, pool?.acquireTimeoutMs ?? 0) },
    attributes: { 'peer.service': peer, 'retry.attempt': attempt, 'client.timeout_ms': timeoutMs, ...(pool ? { 'pool.wait_ms': Math.round(pool.waitMs) } : {}) },
    events: outcome === 'timeout' ? [{ name: 'timeout', timeMs: end, attributes: { 'client.timeout_ms': timeoutMs } }] : [],
  };
}

export function* requestsInMinute(s: Scenario, minute: number, withSpans: boolean): Generator<RequestRecord> {
  const { sampled } = sampleCount(systemStateAt(s, minute));
  for (let i = 0; i < sampled; i++) yield simulateRequest(s, minute, i, withSpans);
}

function emptyHistogram(): Histogram {
  return { buckets: new Array(LATENCY_BUCKETS_S.length + 1).fill(0), sum: 0, count: 0 };
}

function observe(h: Histogram, durationMs: number) {
  const seconds = durationMs / 1000;
  let i = LATENCY_BUCKETS_S.findIndex((le) => seconds <= le);
  if (i === -1) i = LATENCY_BUCKETS_S.length;
  h.buckets[i] = (h.buckets[i] ?? 0) + 1;
  h.sum += seconds;
  h.count += 1;
}

const aggregateCache = new Map<string, MinuteAggregate>();
const AGGREGATE_CACHE_LIMIT = 6000;

// Only mitigations already in force can change a minute, so earlier minutes are shared across what-ifs.
function aggregateKey(s: Scenario, minute: number): string {
  const relevant = s.mitigations.filter((m) => m.effectiveAt <= minute + 1).map((m) => `${m.id}:${m.startedAt}`).join(',');
  return `${nightKey(s)}|${relevant}|${minute}`;
}

export function aggregateMinute(s: Scenario, minute: number): MinuteAggregate {
  const key = aggregateKey(s, minute);
  const cached = aggregateCache.get(key);
  if (cached) return cached;

  const state = systemStateAt(s, minute);
  const { sampled, scale } = sampleCount(state);
  const aggregate: MinuteAggregate = { minute, scale, sampled, server: {}, client: {}, pools: {}, badRequests: 0 };
  for (const request of requestsInMinute(s, minute, false)) {
    for (const server of request.servers) {
      const entry = (aggregate.server[server.component] ??= { errors: 0, histogram: emptyHistogram() });
      observe(entry.histogram, server.durationMs);
      if (server.error) entry.errors += 1;
    }
    for (const call of request.calls) {
      const entry = (aggregate.client[call.callId] ??= { outcomes: { ok: 0, error: 0, timeout: 0, pool_timeout: 0 }, histogram: emptyHistogram() });
      observe(entry.histogram, call.durationMs);
      entry.outcomes[call.outcome] += 1;
      if (call.poolWaitMs === null) continue;
      const pool = (aggregate.pools[call.callId] ??= { wait: emptyHistogram(), use: emptyHistogram(), waitMsTotal: 0 });
      observe(pool.wait, call.poolWaitMs);
      pool.waitMsTotal += call.poolWaitMs;
      if (call.poolHoldMs !== null) observe(pool.use, call.poolHoldMs);
    }
    if (request.error || request.durationMs > s.data.impact.slowMs) aggregate.badRequests += 1;
  }
  if (aggregateCache.size >= AGGREGATE_CACHE_LIMIT) aggregateCache.delete(aggregateCache.keys().next().value as string);
  aggregateCache.set(key, aggregate);
  return aggregate;
}

export function affectedUsers(s: Scenario, untilMinute: number): number {
  let bad = 0;
  for (let m = s.data.historyFrom; m <= untilMinute; m++) {
    const a = aggregateMinute(s, m);
    bad += a.badRequests * a.scale;
  }
  return Math.round(bad * s.data.impact.uniqueUserRatio);
}


export function affectedUsersInMinute(s: Scenario, minute: number): number {
  const a = aggregateMinute(s, minute);
  return Math.round(a.badRequests * a.scale * s.data.impact.uniqueUserRatio);
}
