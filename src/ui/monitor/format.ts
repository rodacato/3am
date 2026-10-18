import type { MetricUnit } from '../../query/promql/unit';

export type Unit = MetricUnit;

// An error ratio lives below 10%; rounding it to whole percents draws a moving line on a flat 0% axis.
function formatPercent(p: number): string {
  return p !== 0 && Math.abs(p) < 10 ? `${+p.toFixed(1)}%` : `${Math.round(p)}%`;
}

export function formatValue(v: number, unit: Unit): string {
  if (!Number.isFinite(v)) return '';
  switch (unit) {
    case 'seconds': return v >= 1 ? `${+v.toFixed(1)}s` : `${Math.round(v * 1000)}ms`;
    case 'ratio': return formatPercent(v * 100);
    case 'percent': return formatPercent(v);
    case 'bytes': return v >= 1 << 30 ? `${+(v / (1 << 30)).toFixed(1)}G` : `${Math.round(v / (1 << 20))}M`;
    case 'rps': return v >= 10 ? `${Math.round(v)}/s` : v >= 1 ? `${+v.toFixed(1)}/s` : `${+v.toFixed(2)}/s`;
    case 'count': return `${Math.round(v)}`;
  }
}
