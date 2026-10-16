import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CaseData } from '../src/engine/case-schema';
import { runTool } from '../src/engine/tools';
import { exportIncident } from '../src/telemetry/otlp';
import { handleRequest } from '../src/worker/handle';
import type { WorkerRequest } from '../src/worker/protocol';
import { loadAllCases, scenario } from './helpers';

let case01: CaseData;
beforeAll(async () => {
  case01 = (await loadAllCases()).find((c) => c.id === 'case-01') as CaseData;
});

describe('worker boundary', () => {
  const ref = { caseId: 'case-01', seed: 5, mitigations: [] };

  it('answers exactly what the engine answers, and survives structured cloning', async () => {
    const body: WorkerRequest = { kind: 'tool', scenario: ref, now: 205, request: { tool: 'logs', filter: 'service:checkout-api level:warn+' } };
    const viaWorker = await handleRequest(body, async () => case01);
    const direct = runTool(scenario(case01, 5), 205, { tool: 'logs', filter: 'service:checkout-api level:warn+' });
    expect(structuredClone(viaWorker)).toEqual(direct);
  });

  it('is deterministic across repeated requests for every kind', async () => {
    const bodies: WorkerRequest[] = [
      { kind: 'pulse', scenario: ref, now: 200 },
      { kind: 'observe', scenario: { ...ref, mitigations: [{ id: 'revert-cfg-413', startedAt: 200, effectiveAt: 205 }] }, effectiveAt: 205 },
      { kind: 'vocabulary', caseId: 'case-01' },
    ];
    for (const body of bodies) {
      const a = JSON.stringify(await handleRequest(body, async () => case01));
      const b = JSON.stringify(await handleRequest(body, async () => case01));
      expect(a).toBe(b);
    }
  });
});

// The parts of the OTLP/JSON encoding real tools rely on: hex ids, string nanos, typed values.
const hex = (n: number) => z.string().regex(new RegExp(`^[0-9a-f]{${n}}$`));
const nanos = z.string().regex(/^\d{19}$/);
const anyValue = z.union([
  z.object({ stringValue: z.string() }).strict(),
  z.object({ intValue: z.string().regex(/^-?\d+$/) }).strict(),
  z.object({ doubleValue: z.number() }).strict(),
  z.object({ boolValue: z.boolean() }).strict(),
]);
const keyValues = z.array(z.object({ key: z.string().min(1), value: anyValue }).strict());
const resource = z.object({ attributes: keyValues }).refine((r) => r.attributes.some((a) => a.key === 'service.name'), 'service.name');
const scope = z.object({ name: z.string(), version: z.string() });

const traces = z.object({
  resourceSpans: z.array(z.object({
    resource,
    scopeSpans: z.array(z.object({
      scope,
      spans: z.array(z.object({
        traceId: hex(32), spanId: hex(16), parentSpanId: hex(16).optional(), name: z.string(), kind: z.number().int().min(0).max(5),
        startTimeUnixNano: nanos, endTimeUnixNano: nanos, attributes: keyValues,
        events: z.array(z.object({ timeUnixNano: nanos, name: z.string(), attributes: keyValues })),
        status: z.object({ code: z.union([z.literal(0), z.literal(1), z.literal(2)]), message: z.string().optional() }),
      }).strict()).min(1),
    })),
  })).min(1),
});

const logs = z.object({
  resourceLogs: z.array(z.object({
    resource,
    scopeLogs: z.array(z.object({
      scope,
      logRecords: z.array(z.object({
        timeUnixNano: nanos, observedTimeUnixNano: nanos, severityNumber: z.number().int().min(1).max(24), severityText: z.string(),
        body: z.object({ stringValue: z.string() }), attributes: keyValues, traceId: hex(32).optional(), spanId: hex(16).optional(),
      }).strict()).min(1),
    })),
  })).min(1),
});

const histogramPoint = z.object({
  attributes: keyValues, startTimeUnixNano: nanos, timeUnixNano: nanos, count: z.string().regex(/^\d+$/), sum: z.number(),
  bucketCounts: z.array(z.string().regex(/^\d+$/)), explicitBounds: z.array(z.number()),
}).refine((p) => p.bucketCounts.length === p.explicitBounds.length + 1, 'bucketCounts = bounds + 1')
  .refine((p) => p.bucketCounts.reduce((a, b) => a + Number(b), 0) === Number(p.count) || Math.abs(p.bucketCounts.reduce((a, b) => a + Number(b), 0) - Number(p.count)) <= p.bucketCounts.length, 'buckets add up to count');
const numberPoint = z.object({ attributes: keyValues, startTimeUnixNano: nanos.optional(), timeUnixNano: nanos, asDouble: z.number() });
const metric = z.object({ name: z.string(), unit: z.string(), description: z.string() }).and(z.union([
  z.object({ histogram: z.object({ aggregationTemporality: z.literal(2), dataPoints: z.array(histogramPoint).min(1) }) }),
  z.object({ sum: z.object({ aggregationTemporality: z.literal(2), isMonotonic: z.literal(true), dataPoints: z.array(numberPoint).min(1) }) }),
  z.object({ gauge: z.object({ dataPoints: z.array(numberPoint).min(1) }) }),
]));
const metrics = z.object({ resourceMetrics: z.array(z.object({ resource, scopeMetrics: z.array(z.object({ scope, metrics: z.array(metric).min(1) })) })).min(1) });

describe('OTLP export', () => {
  it('produces traces, logs and metrics in the OTLP/JSON shape', () => {
    const out = exportIncident(scenario(case01, 1), case01.page.at - 10, case01.page.at);
    expect(() => traces.parse(out.traces)).not.toThrow();
    expect(() => logs.parse(out.logs)).not.toThrow();
    expect(() => metrics.parse(out.metrics)).not.toThrow();
  });

  it('keeps every slow request and links logs to their traces', () => {
    const out = exportIncident(scenario(case01, 1), 200, 202);
    const traceIds = new Set(out.traces.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((sc) => sc.spans.map((sp) => sp.traceId))));
    const timeoutLogs = out.logs.resourceLogs.flatMap((r) => r.scopeLogs.flatMap((sc) => sc.logRecords))
      .filter((l) => l.body.stringValue.includes('timed out after 8000ms'));
    expect(timeoutLogs.length).toBeGreaterThan(0);
    for (const l of timeoutLogs) expect(traceIds.has(l.traceId as string)).toBe(true);
  });
});
