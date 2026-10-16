import type { Scenario } from '../engine/state';
import type { Span } from './otel';
import { requestsInMinute, simulateRequest } from './requests';

export type TraceSummary = {
  ref: string;
  traceId: string;
  rootService: string;
  rootName: string;
  startMs: number;
  durationMs: number;
  error: boolean;
  spanCount: number;
  services: string[];
};

export type TraceCriteria = {
  service?: string;
  operation?: string;
  minDurationMs?: number;
  errorsOnly?: boolean;
  fromMin: number;
  toMin: number;
  limit: number;
};

// A trace ref (minute:index) is enough to rebuild the trace exactly, so nothing has to be stored.
export function traceByRef(s: Scenario, ref: string): Span[] | null {
  const [minute, index] = ref.split(':').map(Number);
  if (minute === undefined || index === undefined || Number.isNaN(minute) || Number.isNaN(index)) return null;
  return simulateRequest(s, minute, index, true).spans;
}

export function searchTraces(s: Scenario, c: TraceCriteria): { traces: TraceSummary[]; scanned: number } {
  const hits: TraceSummary[] = [];
  let scanned = 0;
  for (let m = c.fromMin; m <= c.toMin; m++) {
    for (const request of requestsInMinute(s, m, true)) {
      scanned += 1;
      const spans = request.spans;
      const scoped = spans.filter((sp) => (!c.service || sp.service === c.service) && (!c.operation || sp.name === c.operation));
      if (!scoped.length) continue;
      const worst = scoped.reduce((a, b) => (b.endMs - b.startMs > a.endMs - a.startMs ? b : a));
      if (c.minDurationMs !== undefined && worst.endMs - worst.startMs < c.minDurationMs) continue;
      if (c.errorsOnly && !scoped.some((sp) => sp.status.code === 'ERROR')) continue;
      const root = spans.find((sp) => sp.parentSpanId === null) ?? spans[0];
      if (!root) continue;
      hits.push({
        ref: `${m}:${request.index}`,
        traceId: request.traceId,
        rootService: root.service,
        rootName: root.name,
        startMs: request.startMs,
        durationMs: request.durationMs,
        error: request.error,
        spanCount: spans.length,
        services: [...new Set(spans.map((sp) => sp.service))],
      });
    }
  }
  hits.sort((a, b) => b.durationMs - a.durationMs || a.startMs - b.startMs);
  return { traces: hits.slice(0, c.limit), scanned };
}
