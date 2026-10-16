import { useEffect, useMemo, useRef, useState } from 'react';
import type { CaseData } from '../../engine/case-schema';
import type { Pulse } from '../../telemetry/pulse';
import { layoutSkyline } from './skyline-layout';

type Props = { data: CaseData; seed: number; pulse: Pulse | null; dawn: number; reducedMotion: boolean };

const HOT_CABLE = 0.03;

export function Skyline({ data, seed, pulse, dawn, reducedMotion }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 300 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const sky = useMemo(() => layoutSkyline(data, size.w, size.h, seed), [data, size.w, size.h, seed]);
  const lightFade = Math.max(0.15, 1 - dawn * 0.7);

  return (
    <div ref={ref} className="skyline-box" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '58%' }}>
      <svg className="skyline" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
        {sky.haze.map((h, i) => (
          <rect key={i} x={h.x} y={sky.ground - h.h - size.h * 0.22} width={h.w} height={h.h + size.h * 0.22} fill="#1A222C" opacity={0.9 - dawn * 0.25} />
        ))}
        {sky.river && (
          <g>
            <rect x={sky.river.x} y={sky.ground - 18} width={sky.river.w} height={18} fill="#0A0E13" />
            {Array.from({ length: 8 }, (_, i) => (
              <line key={i} x1={sky.river!.x + 10 + i * (sky.river!.w / 8)} x2={sky.river!.x + 18 + i * (sky.river!.w / 8)} y1={sky.ground - 9 + (i % 3) * 3} y2={sky.ground - 9 + (i % 3) * 3} stroke="#F2A541" strokeOpacity={0.2 * lightFade} />
            ))}
          </g>
        )}
        {sky.cables.map((c) => {
          const hot = (pulse?.calls[c.callId]?.failRatio ?? 0) > HOT_CABLE;
          const rps = pulse?.calls[c.callId]?.rps ?? 0;
          return (
            <g key={c.callId} data-cable={c.callId}>
              <path d={c.path} fill="none" stroke={hot ? '#E0533D' : '#55606D'} strokeOpacity={hot ? 0.85 : 0.6} strokeWidth={hot ? 1.6 : 1.1} style={{ transition: 'stroke 1.2s' }} />
              {!reducedMotion && rps > 0 && Array.from({ length: 3 }, (_, i) => (
                <circle key={i} r={hot ? 2 : 1.5} fill={hot ? '#E0533D' : '#F2A541'} opacity={0.85}>
                  <animateMotion dur={`${Math.max(1.6, 9 / Math.sqrt(rps + 0.5))}s`} begin={`${i * 0.9}s`} repeatCount="indefinite" path={c.path} />
                </circle>
              ))}
            </g>
          );
        })}
        {sky.buildings.map((b) => {
          const health = pulse?.components[b.id];
          // Below 1% unhappy requests a building looks normal; above that, red spreads fast.
          const unhappy = Math.min(0.75, Math.max(0, (health?.errorRatio ?? 0) + (health?.slowRatio ?? 0) - 0.01) * 6);
          const lit = b.cells.filter((cell) => cell.lit);
          const redCount = Math.round(lit.length * unhappy);
          const redOrder = [...lit].sort((p, q) => p.order - q.order).slice(0, redCount);
          const red = new Set(redOrder);
          const roofX = b.x + b.w / 2;
          return (
            <g key={b.id} data-building={b.id}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={b.far ? '#141A22' : '#0F141A'} />
              {b.kind === 'cache' && (
                <g fill="#0F141A">
                  <rect x={roofX - 18} y={b.y - 34} width={36} height={24} />
                  <path d={`M${roofX - 22},${b.y - 34} L${roofX},${b.y - 50} L${roofX + 22},${b.y - 34} Z`} />
                  <rect x={roofX - 14} y={b.y - 10} width={3} height={10} />
                  <rect x={roofX + 11} y={b.y - 10} width={3} height={10} />
                </g>
              )}
              {lit.map((cell, i) => (
                <rect
                  key={i}
                  x={cell.x}
                  y={cell.y}
                  width={5}
                  height={6}
                  fill={red.has(cell) ? '#E0533D' : '#F2A541'}
                  opacity={(red.has(cell) ? 0.85 : b.far ? 0.22 : 0.3 + cell.order * 0.35) * (red.has(cell) ? 1 : lightFade)}
                  style={{ transition: reducedMotion ? undefined : `fill 900ms ${Math.round(cell.order * 900)}ms, opacity 900ms` }}
                />
              ))}
              <rect data-anchor={`bldg-${b.id}`} x={roofX} y={b.y - 2} width={1} height={1} fill="none" />
            </g>
          );
        })}
      </svg>
      {sky.buildings.map((b) => (
        <span
          key={b.id}
          className="bldg-label"
          data-far={b.far}
          style={{ left: b.x + b.w / 2, top: b.y - (b.kind === 'cache' ? 54 : 6) }}
        >
          {b.id}
        </span>
      ))}
    </div>
  );
}
