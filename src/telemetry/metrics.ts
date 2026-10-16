import { smoothNoise } from '../engine/noise';
import { systemStateAt, type Scenario } from '../engine/state';
import type { MetricDescriptor } from './otel';
import { aggregateMinute, hasServerSpans, LATENCY_BUCKETS_S, type Histogram, type MinuteAggregate } from './requests';

export type Labels = Readonly<Record<string, string>>;

export type SeriesDef = {
  id: string;
  labels: Labels;
  kind: 'counter' | 'gauge';
  increment?: (a: MinuteAggregate) => number;
  gauge?: (s: Scenario, minute: number) => number;
};

export const METRICS: readonly MetricDescriptor[] = [
  { name: 'http_server_request_duration_seconds', type: 'histogram', unit: 's', description: 'Duration of HTTP server requests.', labelNames: ['service', 'http_route'] },
  { name: 'http_server_requests_total', type: 'sum', unit: '1', description: 'HTTP server requests by status class.', labelNames: ['service', 'http_route', 'status_class'] },
  { name: 'http_client_request_duration_seconds', type: 'histogram', unit: 's', description: 'Duration of outgoing calls, one observation per attempt.', labelNames: ['service', 'peer_service'] },
  { name: 'http_client_requests_total', type: 'sum', unit: '1', description: 'Outgoing call attempts by outcome.', labelNames: ['service', 'peer_service', 'outcome'] },
  { name: 'process_cpu_utilization_ratio', type: 'gauge', unit: '1', description: 'CPU busy ratio per instance, averaged.', labelNames: ['service'] },
  { name: 'process_memory_usage_bytes', type: 'gauge', unit: 'By', description: 'Resident memory per instance.', labelNames: ['service'] },
];

const LE_LABELS = [...LATENCY_BUCKETS_S.map(String), '+Inf'];

function cumulativeBucket(h: Histogram | undefined, bucketIndex: number): number {
  if (!h) return 0;
  let total = 0;
  for (let i = 0; i <= bucketIndex; i++) total += h.buckets[i] ?? 0;
  return total;
}

function histogramSeries(name: string, base: Labels, pick: (a: MinuteAggregate) => Histogram | undefined): SeriesDef[] {
  const key = Object.values(base).join('/');
  const series: SeriesDef[] = LE_LABELS.map((le, i) => ({
    id: `${name}_bucket/${key}/${le}`,
    labels: { __name__: `${name}_bucket`, ...base, le },
    kind: 'counter',
    increment: (a) => cumulativeBucket(pick(a), i) * a.scale,
  }));
  series.push({ id: `${name}_count/${key}`, labels: { __name__: `${name}_count`, ...base }, kind: 'counter', increment: (a) => (pick(a)?.count ?? 0) * a.scale });
  series.push({ id: `${name}_sum/${key}`, labels: { __name__: `${name}_sum`, ...base }, kind: 'counter', increment: (a) => (pick(a)?.sum ?? 0) * a.scale });
  return series;
}

const catalogCache = new WeakMap<Scenario['data'], SeriesDef[]>();

export function seriesCatalog(s: Scenario): SeriesDef[] {
  const cached = catalogCache.get(s.data);
  if (cached) return cached;
  const out: SeriesDef[] = [];
  for (const component of s.data.components) {
    if (hasServerSpans(component)) {
      const base = { service: component.id, http_route: component.operation };
      out.push(...histogramSeries('http_server_request_duration_seconds', base, (a) => a.server[component.id]?.histogram));
      out.push({
        id: `http_server_requests_total/${component.id}/2xx`, labels: { __name__: 'http_server_requests_total', ...base, status_class: '2xx' }, kind: 'counter',
        increment: (a) => { const e = a.server[component.id]; return e ? (e.histogram.count - e.errors) * a.scale : 0; },
      });
      out.push({
        id: `http_server_requests_total/${component.id}/5xx`, labels: { __name__: 'http_server_requests_total', ...base, status_class: '5xx' }, kind: 'counter',
        increment: (a) => (a.server[component.id]?.errors ?? 0) * a.scale,
      });
      for (const call of component.calls) {
        const base2 = { service: component.id, peer_service: call.to };
        out.push(...histogramSeries('http_client_request_duration_seconds', base2, (a) => a.client[call.id]?.histogram));
        for (const outcome of ['ok', 'error', 'timeout'] as const) {
          out.push({
            id: `http_client_requests_total/${call.id}/${outcome}`, labels: { __name__: 'http_client_requests_total', ...base2, outcome }, kind: 'counter',
            increment: (a) => (a.client[call.id]?.outcomes[outcome] ?? 0) * a.scale,
          });
        }
      }
    }
    if (component.kind !== 'external' && component.instrumented) {
      out.push({ id: `process_cpu_utilization_ratio/${component.id}`, labels: { __name__: 'process_cpu_utilization_ratio', service: component.id }, kind: 'gauge', gauge: (sc, m) => cpuAt(sc, component.id, m) });
      out.push({ id: `process_memory_usage_bytes/${component.id}`, labels: { __name__: 'process_memory_usage_bytes', service: component.id }, kind: 'gauge', gauge: (sc, m) => memoryAt(sc, component.id, m) });
    }
  }
  catalogCache.set(s.data, out);
  return out;
}

// Load a component sees: requests it serves, or calls made to it when it has no server spans (databases).
function componentRps(s: Scenario, componentId: string, minute: number): number {
  const a = aggregateMinute(s, minute);
  const served = a.server[componentId]?.histogram.count;
  if (served !== undefined) return (served * a.scale) / 60;
  let calls = 0;
  for (const component of s.data.components) {
    for (const call of component.calls) if (call.to === componentId) calls += a.client[call.id]?.histogram.count ?? 0;
  }
  return (calls * a.scale) / 60;
}

export function cpuAt(s: Scenario, componentId: string, minute: number): number {
  const component = s.data.components.find((c) => c.id === componentId);
  const live = systemStateAt(s, minute).components.get(componentId);
  if (!component || !live) return 0;
  const wobble = 1 + 0.05 * smoothNoise(s.data.id, s.seed, 'cpu', componentId)(minute / 12);
  const busy = component.cpu.base + (component.cpu.perRps * componentRps(s, componentId, minute)) / live.instances + live.cpuExtra;
  return Math.min(1, Math.max(0, busy * wobble));
}

export function memoryAt(s: Scenario, componentId: string, minute: number): number {
  const live = systemStateAt(s, minute).components.get(componentId);
  if (!live) return 0;
  const wobble = 1 + 0.01 * smoothNoise(s.data.id, s.seed, 'mem', componentId)(minute / 20);
  return live.memoryMb * wobble * 1024 * 1024;
}

// Values per minute in [fromMin, toMin]; counters accumulate from the start of retained history.
export function seriesValues(s: Scenario, def: SeriesDef, fromMin: number, toMin: number): Float64Array {
  const out = new Float64Array(Math.max(0, toMin - fromMin + 1));
  if (def.kind === 'gauge' && def.gauge) {
    for (let m = fromMin; m <= toMin; m++) out[m - fromMin] = def.gauge(s, m);
    return out;
  }
  let total = 0;
  for (let m = s.data.historyFrom; m <= toMin; m++) {
    total += def.increment ? def.increment(aggregateMinute(s, m)) : 0;
    if (m >= fromMin) out[m - fromMin] = total;
  }
  return out;
}
