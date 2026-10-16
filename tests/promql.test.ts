import { describe, expect, it } from 'vitest';
import type { Matcher } from '../src/query/promql/ast';
import { PromQLError } from '../src/query/promql/errors';
import { bucketQuantile, evaluateRange, type SeriesSource } from '../src/query/promql/evaluate';

// A tiny fake Prometheus: two services, a counter growing linearly, a histogram, a gauge.
const series: { labels: Record<string, string>; fn: (m: number) => number }[] = [
  { labels: { __name__: 'reqs_total', service: 'a', code: '200' }, fn: (m: number) => m * 60 },
  { labels: { __name__: 'reqs_total', service: 'a', code: '500' }, fn: (m: number) => m * 6 },
  { labels: { __name__: 'reqs_total', service: 'b', code: '200' }, fn: (m: number) => m * 120 },
  { labels: { __name__: 'dur_bucket', service: 'a', le: '0.1' }, fn: (m: number) => m * 50 },
  { labels: { __name__: 'dur_bucket', service: 'a', le: '1' }, fn: (m: number) => m * 90 },
  { labels: { __name__: 'dur_bucket', service: 'a', le: '+Inf' }, fn: (m: number) => m * 100 },
  { labels: { __name__: 'cpu', service: 'a' }, fn: (m: number) => (m % 2 ? 0.5 : 0.25) },
];

const source: SeriesSource = {
  historyFrom: 0,
  now: 100,
  select: (_: readonly Matcher[]) =>
    series.map((s) => ({ labels: s.labels, values: (from: number, to: number) => Float64Array.from({ length: to - from + 1 }, (_, i) => s.fn(from + i)) })),
};

const at = (query: string, minute = 50) => evaluateRange(source, query, { fromMin: minute, toMin: minute, stepMin: 1 });
const values = (query: string) => at(query).series.map((s) => [s.labels, s.values[0]]);

describe('supported PromQL subset', () => {
  it('selects with label matchers', () => {
    expect(values('reqs_total{service="a"}')).toHaveLength(2);
    expect(values('reqs_total{service!="a"}')).toHaveLength(1);
    expect(values('reqs_total{code=~"5.."}')).toEqual([[{ __name__: 'reqs_total', service: 'a', code: '500' }, 300]]);
    expect(values('reqs_total{code!~"5.."}')).toHaveLength(2);
  });

  it('computes rate and increase over a range and drops the metric name', () => {
    expect(values('rate(reqs_total{service="b"}[5m])')).toEqual([[{ service: 'b', code: '200' }, 2]]);
    expect(values('increase(reqs_total{service="b"}[5m])')).toEqual([[{ service: 'b', code: '200' }, 600]]);
  });

  it('aggregates with sum, avg, max, min, count, by and without', () => {
    expect(values('sum(rate(reqs_total[1m]))')).toEqual([[{}, 3.1]]);
    expect(values('sum by (service) (rate(reqs_total[1m]))')).toEqual([[{ service: 'a' }, 1.1], [{ service: 'b' }, 2]]);
    expect(values('sum without (code) (rate(reqs_total[1m]))')).toEqual([[{ service: 'a' }, 1.1], [{ service: 'b' }, 2]]);
    expect(values('max(rate(reqs_total[1m]))')).toEqual([[{}, 2]]);
    expect(values('min(rate(reqs_total[1m]))')).toEqual([[{}, 0.1]]);
    expect(values('count(reqs_total)')).toEqual([[{}, 3]]);
    expect(values('avg(cpu)')).toEqual([[{}, 0.25]]);
  });

  it('interpolates histogram_quantile within the bucket', () => {
    const [[, p50]] = values('histogram_quantile(0.5, sum by (le) (rate(dur_bucket[5m])))') as [[unknown, number]];
    expect(p50).toBeCloseTo(0.1, 6);
    const [[, p90]] = values('histogram_quantile(0.9, sum by (le) (rate(dur_bucket[5m])))') as [[unknown, number]];
    expect(p90).toBeCloseTo(1, 6);
    expect(bucketQuantile(0.99, [{ le: 1, count: 90 }, { le: Infinity, count: 100 }])).toBe(1);
  });

  it('does arithmetic and comparisons with one-to-one matching', () => {
    expect(values('sum(rate(reqs_total{code="500"}[1m])) / sum(rate(reqs_total{service="a"}[1m]))')[0]?.[1]).toBeCloseTo(0.1 / 1.1, 6);
    expect(values('rate(reqs_total[1m]) > 1')).toEqual([[{ __name__: undefined, service: 'b', code: '200' }, 2]].map(([l, v]) => [Object.fromEntries(Object.entries(l as object).filter(([, x]) => x !== undefined)), v]));
    expect(values('cpu * 100')).toEqual([[{ service: 'a' }, 25]]);
    expect(values('-cpu')).toEqual([[{ service: 'a' }, -0.25]]);
    expect(at('2 * 3 + 1').series[0]?.values[0]).toBe(7);
  });

  it('returns null for steps outside retained history', () => {
    const r = evaluateRange(source, 'cpu', { fromMin: 99, toMin: 102, stepMin: 1 });
    expect(r.series[0]?.values).toEqual([0.5, 0.25, null, null]);
  });
});

describe('honest errors for what the subset does not do', () => {
  const code = (query: string) => {
    try {
      at(query);
      return 'ok';
    } catch (e) {
      if (e instanceof PromQLError) return `${e.code}:${e.detail}`;
      throw e;
    }
  };
  it.each([
    ['rate(reqs_total[5m] offset 1h)', 'unsupported_feature:offset'],
    ['topk(3, reqs_total)', 'unsupported_aggregation:topk'],
    ['quantile(0.9, cpu)', 'unsupported_aggregation:quantile'],
    ['predict_linear(cpu[1h], 3600)', 'unsupported_function:predict_linear'],
    ['rate(reqs_total[5m:1m])', 'unsupported_feature:subquery'],
    ['reqs_total and cpu', 'unsupported_feature:and'],
    ['cpu > bool 0.3', 'unsupported_feature:bool'],
    ['reqs_total / on(service) cpu', 'unsupported_feature:on(service)'],
    ['1 > 2', 'scalar_comparison:>'],
    ['rate(cpu)', 'expected_range:rate'],
    ['sum(cpu[5m])', 'expected_instant:range vector'],
    ['', 'empty_query:'],
  ])('%s → %s', (query, expected) => {
    expect(code(query)).toBe(expected);
  });

  it('reports syntax errors instead of guessing', () => {
    expect(code('sum(rate(reqs_total[5m])')).toMatch(/^syntax:/);
    expect(code('cpu{service=}')).toMatch(/^syntax:/);
  });
});
