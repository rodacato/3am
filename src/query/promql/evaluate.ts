import type { Labels } from '../../telemetry/metrics';
import { COMPARISON_OPS, type AggregateOp, type BinaryOp, type ComparisonOp, type Expr, type Matcher } from './ast';
import { PromQLError } from './errors';
import { parsePromQL } from './parse';

export type SourceSeries = { labels: Labels; values(fromMin: number, toMin: number): Float64Array };

export interface SeriesSource {
  readonly historyFrom: number;
  readonly now: number;
  select(matchers: readonly Matcher[]): SourceSeries[];
}

export type RangeQuery = { fromMin: number; toMin: number; stepMin: number };
export type ResultSeries = { labels: Labels; values: (number | null)[] };
export type QueryResult = { resultType: 'vector' | 'scalar'; times: number[]; series: ResultSeries[] };

type VectorSeries = { labels: Labels; v: Float64Array };
type Value = { kind: 'scalar'; v: Float64Array } | { kind: 'vector'; series: VectorSeries[] };

export function compileMatcher(m: Matcher): (value: string) => boolean {
  if (m.op === '=') return (v) => v === m.value;
  if (m.op === '!=') return (v) => v !== m.value;
  let re: RegExp;
  try {
    re = new RegExp(`^(?:${m.value})$`);
  } catch {
    throw new PromQLError('bad_regex', m.value, 0);
  }
  return m.op === '=~' ? (v) => re.test(v) : (v) => !re.test(v);
}

function withoutName(labels: Labels): Labels {
  const { __name__: _name, ...rest } = labels;
  return rest;
}

function signature(labels: Labels, keep?: (name: string) => boolean): string {
  return Object.keys(labels)
    .filter((k) => !keep || keep(k))
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}

function pickLabels(labels: Labels, keep: (name: string) => boolean): Labels {
  const out: Record<string, string> = {};
  for (const k of Object.keys(labels).sort()) if (keep(k)) out[k] = labels[k] as string;
  return out;
}

const arithmetic: Record<string, (a: number, b: number) => number> = {
  '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b,
  '%': (a, b) => a % b, '^': (a, b) => a ** b,
};
const comparison: Record<ComparisonOp, (a: number, b: number) => boolean> = {
  '==': (a, b) => a === b, '!=': (a, b) => a !== b, '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b,
};
const isComparison = (op: BinaryOp): op is ComparisonOp => (COMPARISON_OPS as readonly string[]).includes(op);

function combine(op: BinaryOp, a: number, b: number, filterValue: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  if (isComparison(op)) return comparison[op](a, b) ? filterValue : NaN;
  return (arithmetic[op] as (x: number, y: number) => number)(a, b);
}

// Standard bucket interpolation, as Prometheus does it for classic histograms.
export function bucketQuantile(q: number, buckets: { le: number; count: number }[]): number {
  if (Number.isNaN(q)) return NaN;
  if (q < 0) return -Infinity;
  if (q > 1) return Infinity;
  const sorted = [...buckets].sort((a, b) => a.le - b.le);
  const last = sorted[sorted.length - 1];
  if (!last || last.le !== Infinity || sorted.length < 2) return NaN;
  const total = last.count;
  if (!(total > 0)) return NaN;
  const rank = q * total;
  let i = sorted.findIndex((b) => b.count >= rank);
  if (i === -1) i = sorted.length - 1;
  if (i === sorted.length - 1) return (sorted[sorted.length - 2] as { le: number }).le;
  const upper = sorted[i] as { le: number; count: number };
  const lower = i === 0 ? { le: 0, count: 0 } : (sorted[i - 1] as { le: number; count: number });
  if (i === 0 && upper.le <= 0) return upper.le;
  const inBucket = upper.count - lower.count;
  if (inBucket <= 0) return upper.le;
  return lower.le + (upper.le - lower.le) * ((rank - lower.count) / inBucket);
}

export function evaluateRange(source: SeriesSource, query: string, range: RangeQuery): QueryResult {
  const expr = parsePromQL(query);
  const times: number[] = [];
  for (let t = range.fromMin; t <= range.toMin; t += range.stepMin) times.push(t);
  const n = times.length;
  const first = times[0] ?? range.fromMin;
  const last = times[n - 1] ?? range.toMin;

  const fetch = (series: SourceSeries, lookbackMin: number) => {
    const lo = Math.max(source.historyFrom, first - lookbackMin);
    const hi = Math.min(source.now, last);
    const raw = hi >= lo ? series.values(lo, hi) : new Float64Array(0);
    return (minute: number) => (minute < lo || minute > hi ? NaN : (raw[minute - lo] ?? NaN));
  };

  const select = (matchers: readonly Matcher[]) => {
    const compiled = matchers.map((m) => ({ name: m.name, test: compileMatcher(m) }));
    return source.select(matchers).filter((s) => compiled.every((m) => m.test(s.labels[m.name] ?? '')));
  };

  const scalar = (value: number): Value => ({ kind: 'scalar', v: new Float64Array(n).fill(value) });

  const evaluate = (e: Expr): Value => {
    switch (e.type) {
      case 'number':
        return scalar(e.value);
      case 'vector':
        return {
          kind: 'vector',
          series: select(e.matchers).map((s) => {
            const at = fetch(s, 0);
            return { labels: s.labels, v: Float64Array.from(times, at) };
          }),
        };
      case 'matrix':
        throw new PromQLError('expected_instant', 'range vector', 0);
      case 'negate': {
        const inner = evaluate(e.expr);
        if (inner.kind === 'scalar') return { kind: 'scalar', v: inner.v.map((x) => -x) };
        return { kind: 'vector', series: inner.series.map((s) => ({ labels: withoutName(s.labels), v: s.v.map((x) => -x) })) };
      }
      case 'call':
        return evaluateCall(e);
      case 'aggregate':
        return evaluateAggregate(e.op, e.grouping, evaluate(e.expr));
      case 'binary':
        return evaluateBinary(e.op, evaluate(e.lhs), evaluate(e.rhs));
    }
  };

  const evaluateCall = (e: Extract<Expr, { type: 'call' }>): Value => {
    if (e.fn === 'rate' || e.fn === 'increase') {
      const arg = e.args[0];
      if (e.args.length !== 1 || !arg || arg.type !== 'matrix') throw new PromQLError('expected_range', e.fn, 0);
      const window = arg.rangeMin;
      return {
        kind: 'vector',
        series: select(arg.selector.matchers).map((s) => {
          const at = fetch(s, Math.ceil(window));
          const v = Float64Array.from(times, (t) => {
            const delta = at(t) - at(t - Math.round(window));
            return e.fn === 'rate' ? delta / (window * 60) : delta;
          });
          return { labels: withoutName(s.labels), v };
        }),
      };
    }
    const [phiExpr, vectorExpr] = e.args;
    if (e.args.length !== 2 || !phiExpr || !vectorExpr) throw new PromQLError('syntax', 'histogram_quantile', 0);
    const phi = evaluate(phiExpr);
    if (phi.kind !== 'scalar') throw new PromQLError('expected_scalar', 'histogram_quantile', 0);
    const input = evaluate(vectorExpr);
    if (input.kind !== 'vector') throw new PromQLError('expected_instant', 'histogram_quantile', 0);
    const groups = new Map<string, { labels: Labels; buckets: { le: number; v: Float64Array }[] }>();
    for (const s of input.series) {
      const le = s.labels.le;
      if (le === undefined) continue;
      const labels = pickLabels(s.labels, (k) => k !== 'le' && k !== '__name__');
      const key = signature(labels);
      const group = groups.get(key) ?? { labels, buckets: [] };
      group.buckets.push({ le: le === '+Inf' ? Infinity : Number(le), v: s.v });
      groups.set(key, group);
    }
    return {
      kind: 'vector',
      series: [...groups.values()].map((g) => ({
        labels: g.labels,
        v: Float64Array.from(times, (_, i) => bucketQuantile(phi.v[i] ?? NaN, g.buckets.map((b) => ({ le: b.le, count: b.v[i] ?? NaN })))),
      })),
    };
  };

  const evaluateAggregate = (op: AggregateOp, grouping: { mode: 'by' | 'without'; labels: string[] } | null, input: Value): Value => {
    if (input.kind !== 'vector') throw new PromQLError('expected_instant', op, 0);
    const keep = (k: string) => {
      if (!grouping) return false;
      return grouping.mode === 'by' ? grouping.labels.includes(k) : k !== '__name__' && !grouping.labels.includes(k);
    };
    const groups = new Map<string, { labels: Labels; members: Float64Array[] }>();
    for (const s of input.series) {
      const labels = pickLabels(s.labels, keep);
      const key = signature(labels);
      const group = groups.get(key) ?? { labels, members: [] };
      group.members.push(s.v);
      groups.set(key, group);
    }
    const reduce = (values: number[]): number => {
      if (!values.length) return NaN;
      switch (op) {
        case 'sum': return values.reduce((a, b) => a + b, 0);
        case 'avg': return values.reduce((a, b) => a + b, 0) / values.length;
        case 'min': return Math.min(...values);
        case 'max': return Math.max(...values);
        case 'count': return values.length;
      }
    };
    return {
      kind: 'vector',
      series: [...groups.values()].map((g) => ({
        labels: g.labels,
        v: Float64Array.from(times, (_, i) => reduce(g.members.map((m) => m[i] ?? NaN).filter((x) => !Number.isNaN(x)))),
      })),
    };
  };

  const evaluateBinary = (op: BinaryOp, lhs: Value, rhs: Value): Value => {
    if (lhs.kind === 'scalar' && rhs.kind === 'scalar') {
      if (isComparison(op)) throw new PromQLError('scalar_comparison', op, 0);
      return { kind: 'scalar', v: Float64Array.from(times, (_, i) => combine(op, lhs.v[i] ?? NaN, rhs.v[i] ?? NaN, NaN)) };
    }
    const relabel = (labels: Labels) => (isComparison(op) ? labels : withoutName(labels));
    if (lhs.kind === 'vector' && rhs.kind === 'scalar') {
      return { kind: 'vector', series: lhs.series.map((s) => ({ labels: relabel(s.labels), v: Float64Array.from(times, (_, i) => combine(op, s.v[i] ?? NaN, rhs.v[i] ?? NaN, s.v[i] ?? NaN)) })) };
    }
    if (lhs.kind === 'scalar' && rhs.kind === 'vector') {
      return { kind: 'vector', series: rhs.series.map((s) => ({ labels: relabel(s.labels), v: Float64Array.from(times, (_, i) => combine(op, lhs.v[i] ?? NaN, s.v[i] ?? NaN, s.v[i] ?? NaN)) })) };
    }
    if (lhs.kind !== 'vector' || rhs.kind !== 'vector') throw new PromQLError('expected_instant', op, 0);
    const right = new Map(rhs.series.map((s) => [signature(s.labels, (k) => k !== '__name__'), s]));
    const out: VectorSeries[] = [];
    for (const l of lhs.series) {
      const r = right.get(signature(l.labels, (k) => k !== '__name__'));
      if (!r) continue;
      out.push({ labels: relabel(l.labels), v: Float64Array.from(times, (_, i) => combine(op, l.v[i] ?? NaN, r.v[i] ?? NaN, l.v[i] ?? NaN)) });
    }
    return { kind: 'vector', series: out };
  };

  const value = evaluate(expr);
  const toNullable = (v: Float64Array) => Array.from(v, (x) => (Number.isFinite(x) ? x : null));
  if (value.kind === 'scalar') return { resultType: 'scalar', times, series: [{ labels: {}, values: toNullable(value.v) }] };
  return {
    resultType: 'vector',
    times,
    series: value.series
      .map((s) => ({ labels: s.labels, values: toNullable(s.v) }))
      .filter((s) => s.values.some((x) => x !== null))
      .sort((a, b) => signature(a.labels).localeCompare(signature(b.labels))),
  };
}
