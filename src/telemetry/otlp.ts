import type { Scenario } from '../engine/state';
import { minuteToMs } from '../engine/time';
import { logsInMinute } from './logs';
import { METRICS, seriesCatalog, seriesValues, type SeriesDef } from './metrics';
import { resourceFor, type AttributeValue, type Attributes, type LogRecord, type Span } from './otel';
import { LATENCY_BUCKETS_S, requestsInMinute } from './requests';

// OTLP/JSON encoding: ids as hex, 64-bit integers as decimal strings, one object per signal.

type AnyValue = { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean };
type KeyValue = { key: string; value: AnyValue };

const SCOPE = { name: '3am.simulator', version: '1' };
const KIND = { INTERNAL: 1, SERVER: 2, CLIENT: 3 } as const;
const STATUS = { UNSET: 0, OK: 1, ERROR: 2 } as const;
const TEMPORALITY_CUMULATIVE = 2;
// Every slow or failed request is kept; healthy ones are sampled so the files stay a few megabytes.
const HEALTHY_SAMPLE_EVERY = 25;

function anyValue(v: AttributeValue): AnyValue {
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  return { stringValue: v };
}

function attrs(a: Attributes): KeyValue[] {
  return Object.entries(a).map(([key, v]) => ({ key, value: anyValue(v) }));
}

const nanos = (ms: number) => `${Math.round(ms * 1000)}000`;

function resource(service: string) {
  return { attributes: attrs(resourceFor(service)) };
}

function byService<T extends { service: string }>(items: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(item.service, [...(out.get(item.service) ?? []), item]);
  return out;
}

export function exportTraces(s: Scenario, fromMin: number, toMin: number) {
  const spans: Span[] = [];
  for (let m = fromMin; m <= toMin; m++) {
    for (const r of requestsInMinute(s, m, true)) {
      if (r.error || r.durationMs > s.data.impact.slowMs || r.index % HEALTHY_SAMPLE_EVERY === 0) spans.push(...r.spans);
    }
  }
  return {
    resourceSpans: [...byService(spans)].map(([service, list]) => ({
      resource: resource(service),
      scopeSpans: [{
        scope: SCOPE,
        spans: list.map((sp) => ({
          traceId: sp.traceId,
          spanId: sp.spanId,
          ...(sp.parentSpanId ? { parentSpanId: sp.parentSpanId } : {}),
          name: sp.name,
          kind: KIND[sp.kind],
          startTimeUnixNano: nanos(sp.startMs),
          endTimeUnixNano: nanos(sp.endMs),
          attributes: attrs(sp.attributes),
          events: sp.events.map((e) => ({ timeUnixNano: nanos(e.timeMs), name: e.name, attributes: attrs(e.attributes) })),
          status: { code: STATUS[sp.status.code], ...(sp.status.message ? { message: sp.status.message } : {}) },
        })),
      }],
    })),
  };
}

export function exportLogs(s: Scenario, fromMin: number, toMin: number) {
  const records: LogRecord[] = [];
  for (let m = fromMin; m <= toMin; m++) records.push(...logsInMinute(s, m));
  return {
    resourceLogs: [...byService(records)].map(([service, list]) => ({
      resource: resource(service),
      scopeLogs: [{
        scope: SCOPE,
        logRecords: list.map((r) => ({
          timeUnixNano: nanos(r.timeMs),
          observedTimeUnixNano: nanos(r.timeMs),
          severityNumber: r.severityNumber,
          severityText: r.severityText,
          body: { stringValue: r.body },
          attributes: attrs({ ...r.attributes, 'log.template': r.templateId }),
          ...(r.traceId ? { traceId: r.traceId } : {}),
          ...(r.spanId ? { spanId: r.spanId } : {}),
        })),
      }],
    })),
  };
}

function pointLabels(def: SeriesDef): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(def.labels)) if (k !== '__name__' && k !== 'le' && k !== 'service') out[k] = v;
  return out;
}

export function exportMetrics(s: Scenario, fromMin: number, toMin: number) {
  const catalog = seriesCatalog(s);
  const start = nanos(minuteToMs(s.data.date, s.data.historyFrom));
  const services = [...new Set(catalog.map((d) => d.labels.service as string))];
  return {
    resourceMetrics: services.map((service) => {
      const mine = catalog.filter((d) => d.labels.service === service);
      const metrics = METRICS.flatMap((desc): Record<string, unknown>[] => {
        if (desc.type === 'histogram') {
          const groups = new Map<string, SeriesDef[]>();
          for (const d of mine) {
            const name = d.labels.__name__ ?? '';
            if (!name.startsWith(desc.name + '_')) continue;
            const key = JSON.stringify(pointLabels(d));
            groups.set(key, [...(groups.get(key) ?? []), d]);
          }
          if (!groups.size) return [];
          const dataPoints = [...groups.values()].flatMap((defs) => {
            const bucket = (le: string) => defs.find((d) => d.labels.le === le);
            const les = [...LATENCY_BUCKETS_S.map(String), '+Inf'];
            const cumulative = les.map((le) => { const d = bucket(le); return d ? seriesValues(s, d, fromMin, toMin) : new Float64Array(toMin - fromMin + 1); });
            const count = defs.find((d) => d.labels.__name__ === `${desc.name}_count`);
            const sum = defs.find((d) => d.labels.__name__ === `${desc.name}_sum`);
            const counts = count ? seriesValues(s, count, fromMin, toMin) : new Float64Array(0);
            const sums = sum ? seriesValues(s, sum, fromMin, toMin) : new Float64Array(0);
            return Array.from({ length: toMin - fromMin + 1 }, (_, i) => ({
              attributes: attrs(pointLabels(defs[0] as SeriesDef)),
              startTimeUnixNano: start,
              timeUnixNano: nanos(minuteToMs(s.data.date, fromMin + i + 1)),
              count: String(Math.round(counts[i] ?? 0)),
              sum: sums[i] ?? 0,
              bucketCounts: cumulative.map((c, b) => String(Math.round((c[i] ?? 0) - (b ? (cumulative[b - 1]?.[i] ?? 0) : 0)))),
              explicitBounds: [...LATENCY_BUCKETS_S],
            }));
          });
          return [{ name: desc.name, unit: desc.unit, description: desc.description, histogram: { aggregationTemporality: TEMPORALITY_CUMULATIVE, dataPoints } }];
        }
        const defs = mine.filter((d) => d.labels.__name__ === desc.name);
        if (!defs.length) return [];
        const dataPoints = defs.flatMap((d) => {
          const values = seriesValues(s, d, fromMin, toMin);
          return Array.from(values, (v, i) => ({
            attributes: attrs(pointLabels(d)),
            ...(desc.type === 'sum' ? { startTimeUnixNano: start } : {}),
            timeUnixNano: nanos(minuteToMs(s.data.date, fromMin + i + 1)),
            asDouble: v,
          }));
        });
        const body = desc.type === 'sum'
          ? { sum: { aggregationTemporality: TEMPORALITY_CUMULATIVE, isMonotonic: true, dataPoints } }
          : { gauge: { dataPoints } };
        return [{ name: desc.name, unit: desc.unit, description: desc.description, ...body }];
      });
      return { resource: resource(service), scopeMetrics: [{ scope: SCOPE, metrics }] };
    }),
  };
}

export function exportIncident(s: Scenario, fromMin: number, toMin: number) {
  return { traces: exportTraces(s, fromMin, toMin), logs: exportLogs(s, fromMin, toMin), metrics: exportMetrics(s, fromMin, toMin) };
}
