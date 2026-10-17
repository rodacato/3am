import type { Expr, VectorSelector } from './ast';
import { parsePromQL } from './parse';

export type MetricUnit = 'seconds' | 'ratio' | 'rps' | 'percent' | 'bytes' | 'count';

function selectorUnit(selector: VectorSelector): MetricUnit {
  const name = selector.matchers.find((m) => m.name === '__name__')?.value ?? '';
  if (/_seconds(_bucket|_sum)?$/.test(name)) return 'seconds';
  if (/_ratio$|cpu_utilization/.test(name)) return 'ratio';
  if (/_bytes$/.test(name)) return 'bytes';
  return 'count';
}

// null is a bare number: it scales or compares, it carries no unit of its own.
function unitOf(e: Expr): MetricUnit | null {
  switch (e.type) {
    case 'number': return null;
    case 'vector': return selectorUnit(e);
    case 'matrix': return selectorUnit(e.selector);
    case 'negate': return unitOf(e.expr);
    case 'aggregate': return e.op === 'count' ? 'count' : unitOf(e.expr);
    case 'call': {
      if (e.fn === 'histogram_quantile') return e.args[1] ? unitOf(e.args[1]) : null;
      const inner = e.args[0] ? unitOf(e.args[0]) : null;
      if (e.fn === 'rate') return inner === 'count' ? 'rps' : inner;
      return inner;
    }
    case 'binary': {
      const lhs = unitOf(e.lhs);
      const rhs = unitOf(e.rhs);
      if (e.op === '/' && lhs !== null && lhs === rhs) return timesHundred(e.lhs) ? 'percent' : 'ratio';
      if (e.op === '*' && timesHundred(e) && (lhs ?? rhs) === 'ratio') return 'percent';
      return lhs ?? rhs;
    }
  }
}

function timesHundred(e: Expr): boolean {
  return e.type === 'binary' && e.op === '*' && [e.lhs, e.rhs].some((x) => x.type === 'number' && x.value === 100);
}

export function metricUnit(query: string): MetricUnit {
  try {
    return unitOf(parsePromQL(query)) ?? 'count';
  } catch {
    return 'count';
  }
}
