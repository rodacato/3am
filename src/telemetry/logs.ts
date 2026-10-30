import type { LogTemplate } from '../engine/case-schema';
import { createRng, type Rng } from '../engine/random';
import { isEffectActive, nightKey, type Scenario } from '../engine/state';
import { effectShift } from '../engine/jitter';
import { minuteToMs } from '../engine/time';
import { SEVERITY_NUMBER, type LogRecord } from './otel';
import { requestsInMinute, type CallRecord, type ServerRecord } from './requests';

type Fill = Record<string, string | number>;

// {name} comes from the event; {int:a-b} and {hex:n} are drawn from the seeded stream.
export function renderBody(template: string, fill: Fill, rng: Rng): string {
  return template.replace(/\{([a-zA-Z_]+)(?::([^}]+))?\}/g, (whole, name: string, arg: string | undefined) => {
    if (name === 'int' && arg) {
      const [lo, hi] = arg.split('-').map(Number);
      if (lo === undefined || hi === undefined) return whole;
      return String(lo + rng.int(hi - lo + 1));
    }
    if (name === 'hex' && arg) return rng.hex(Number(arg));
    const value = fill[name];
    return value === undefined ? whole : String(value);
  });
}

function makeRecord(t: LogTemplate, timeMs: number, body: string, seq: number, minute: number, traceId: string | null, spanId: string | null, extra: Fill): LogRecord {
  const attributes: LogRecord['attributes'] = { ...t.attributes };
  for (const [k, v] of Object.entries(extra)) attributes[k] = v;
  return {
    id: `${minute}-${seq}`,
    timeMs,
    service: t.component,
    severityText: t.severity === 'FATAL' ? 'FATAL' : t.severity,
    severityNumber: SEVERITY_NUMBER[t.severity],
    body,
    templateId: t.id,
    attributes,
    traceId,
    spanId,
  };
}

function callFill(call: CallRecord, peer: string): Fill {
  return { attempt: call.attempt, maxAttempts: call.maxAttempts, timeoutMs: call.timeoutMs, elapsedMs: Math.round(call.durationMs), waitMs: Math.round(call.poolWaitMs ?? 0), peer };
}

function serverFill(server: ServerRecord): Fill {
  return { durationMs: Math.round(server.durationMs) };
}

const minuteCache = new Map<string, LogRecord[]>();

export function logsInMinute(s: Scenario, minute: number): LogRecord[] {
  const relevant = s.mitigations.filter((m) => m.effectiveAt <= minute + 1).map((m) => `${m.id}:${m.startedAt}`).join(',');
  const key = `${nightKey(s)}|${relevant}|${minute}`;
  const cached = minuteCache.get(key);
  if (cached) return cached;

  const out: LogRecord[] = [];
  const rng = createRng(s.data.id, s.seed, 'logs', minute);
  const peers = new Map(s.data.components.flatMap((c) => c.calls.map((call) => [call.id, call.to] as const)));
  const spanTemplates = s.data.logs.filter((t) => t.trigger.kind !== 'rate');
  let seq = 0;

  if (spanTemplates.length) {
    for (const request of requestsInMinute(s, minute, false)) {
      for (const t of spanTemplates) {
        const trig = t.trigger;
        if (trig.kind === 'attemptTimeout' || trig.kind === 'retry' || trig.kind === 'poolTimeout') {
          for (const call of request.calls) {
            if (call.callId !== trig.call) continue;
            const hit = trig.kind === 'retry' ? call.outcome !== 'ok' && call.attempt < call.maxAttempts : call.outcome === (trig.kind === 'attemptTimeout' ? 'timeout' : 'pool_timeout');
            if (!hit) continue;
            const fill: Fill = { ...callFill(call, peers.get(call.callId) ?? ''), orderId: `ord_${rng.hex(6)}` };
            const time = call.startMs + call.durationMs + (trig.kind === 'retry' ? 1 : 0);
            out.push(makeRecord(t, time, renderBody(t.body, fill, rng), seq++, minute, request.traceId, call.spanId, { 'retry.attempt': call.attempt, 'peer.service': String(fill.peer), 'elapsed_ms': Number(fill.elapsedMs) }));
          }
        } else {
          for (const server of request.servers) {
            if (server.component !== t.component) continue;
            const hit = trig.kind === 'serverError' ? server.error : trig.kind === 'slowRequest' && server.durationMs > trig.thresholdMs;
            if (!hit) continue;
            const fill: Fill = { ...serverFill(server), orderId: `ord_${rng.hex(6)}` };
            out.push(makeRecord(t, server.startMs + server.durationMs, renderBody(t.body, fill, rng), seq++, minute, request.traceId, server.spanId, { duration_ms: Number(fill.durationMs) }));
          }
        }
      }
    }
  }

  const minuteStart = minuteToMs(s.data.date, minute);
  for (const t of s.data.logs) {
    const trig = t.trigger;
    if (trig.kind !== 'rate') continue;
    const shift = effectShift(s, trig.followsEffect);
    if ((trig.from !== undefined && minute < trig.from + shift) || (trig.until !== undefined && minute >= trig.until + shift)) continue;
    if (trig.followsEffect && !isEffectActive(s, trig.followsEffect, minute)) continue;
    const count = Math.floor(trig.perMin) + (rng.chance(trig.perMin % 1) ? 1 : 0);
    for (let i = 0; i < count; i++) {
      out.push(makeRecord(t, minuteStart + rng.next() * 60_000, renderBody(t.body, {}, rng), seq++, minute, null, null, {}));
    }
  }

  out.sort((a, b) => a.timeMs - b.timeMs);
  if (minuteCache.size > 3000) minuteCache.delete(minuteCache.keys().next().value as string);
  minuteCache.set(key, out);
  return out;
}
