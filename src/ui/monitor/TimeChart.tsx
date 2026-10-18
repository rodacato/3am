import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import { clockLabel } from '../../engine/time';
import { useLatest } from '../useLatest';
import { formatValue, type Unit } from './format';

export type ChartSeries = { label: string; values: (number | null)[] };

type Props = {
  times: number[];
  series: ChartSeries[];
  unit: Unit;
  height: number;
  revealUpTo?: number;
  markers?: { minute: number; color: string }[];
  onSelect?: (fromMinute: number, toMinute: number) => void;
  compact?: boolean;
};

const AXIS = { stroke: '#848D99', font: '11px "IBM Plex Mono"', grid: { stroke: '#262D37', width: 1, dash: [2, 4] }, ticks: { show: false } };

export function seriesColor(label: string, index: number): { stroke: string; dash?: number[] } {
  if (/=error/i.test(label)) return { stroke: '#E0533D', dash: [3, 3] };
  if (/5xx|error|timeout/i.test(label)) return { stroke: '#E0533D' };
  return [{ stroke: '#E8E2D6' }, { stroke: '#F2A541' }, { stroke: '#6B7480' }, { stroke: '#C9C3B6', dash: [4, 3] }][index % 4] as { stroke: string; dash?: number[] };
}

export function TimeChart({ times, series, unit, height, revealUpTo, markers = [], onSelect, compact = false }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const minWidth = compact ? 80 : 200;
  const plot = useRef<uPlot | null>(null);
  const onSelectRef = useLatest(onSelect);
  const markersRef = useLatest(markers);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const opts: uPlot.Options = {
      width: Math.max(minWidth, el.clientWidth),
      height,
      legend: { show: false },
      cursor: { drag: { x: Boolean(onSelectRef.current), y: false, setScale: false }, points: { show: false } },
      scales: { x: { time: false }, y: { range: (_u, min, max) => [Math.min(0, min), max <= 0 ? 1 : max * 1.12] } },
      axes: compact
        ? [{ show: false }, { show: false }]
        : [
          { ...AXIS, values: (_u, splits) => splits.map((s) => clockLabel(Math.round(s))), space: 70 },
          { ...AXIS, values: (_u, splits) => splits.map((s) => formatValue(s, unit)), size: 52 },
        ],
      padding: compact ? [4, 0, 4, 0] : undefined,
      series: [{}, ...series.map((s, i) => ({ label: s.label, ...seriesColor(s.label, i), width: 1.6, points: { show: false }, spanGaps: false }))],
      hooks: {
        setSelect: [(u) => {
          if (u.select.width < 4) return;
          const from = u.posToVal(u.select.left, 'x');
          const to = u.posToVal(u.select.left + u.select.width, 'x');
          onSelectRef.current?.(Math.round(from), Math.round(to));
        }],
        draw: [(u) => {
          const ctx = u.ctx;
          for (const m of markersRef.current) {
            const x = u.valToPos(m.minute, 'x', true);
            if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
            ctx.save();
            ctx.strokeStyle = m.color;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x, u.bbox.top);
            ctx.lineTo(x, u.bbox.top + u.bbox.height);
            ctx.stroke();
            ctx.restore();
          }
        }],
      },
    };
    const u = new uPlot(opts, [[], ...series.map(() => [])] as uPlot.AlignedData, el);
    plot.current = u;
    const resize = new ResizeObserver(() => u.setSize({ width: Math.max(minWidth, el.clientWidth), height }));
    resize.observe(el);
    return () => {
      resize.disconnect();
      u.destroy();
      plot.current = null;
    };
    // The plot is rebuilt only when the shape of the data changes; values flow through setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.length, series.map((s) => s.label).join('|'), unit, height, compact]);

  useEffect(() => {
    const u = plot.current;
    if (!u) return;
    const cut = revealUpTo ?? Infinity;
    const data = [times, ...series.map((s) => s.values.map((v, i) => ((times[i] ?? 0) <= cut ? v : null)))] as uPlot.AlignedData;
    u.setData(data, true);
    if (times.length) u.setScale('x', { min: times[0] as number, max: times[times.length - 1] as number });
  }, [times, series, revealUpTo]);

  return (
    <div className="chart">
      <div ref={box} />
      {series.length > 1 && !compact && (
        <div className="chart__legend">
          {series.map((s, i) => <span key={s.label} style={{ ['--c' as string]: seriesColor(s.label, i).stroke }}>{s.label}</span>)}
        </div>
      )}
    </div>
  );
}
