import type { CaseData, Component } from '../../engine/case-schema';
import { createRng } from '../../engine/random';

export type Building = { id: string; kind: Component['kind']; x: number; y: number; w: number; h: number; far: boolean; cells: Cell[] };
export type Cell = { x: number; y: number; lit: boolean; order: number };
export type Cable = { callId: string; from: string; to: string; path: string };
export type Skyline = { width: number; height: number; ground: number; buildings: Building[]; cables: Cable[]; river: { x: number; w: number } | null; haze: { x: number; w: number; h: number }[] };

const BASE = { width: 1440, height: 420 };

function size(c: Component): { w: number; h: number } {
  switch (c.kind) {
    case 'database': return { w: 210, h: 112 };
    case 'cache': return { w: 96, h: 168 };
    case 'queue': return { w: 170, h: 70 };
    case 'external': return { w: 116, h: 214 };
    case 'service': return { w: 124, h: 150 + 50 * c.calls.length };
  }
}

function depths(data: CaseData): Map<string, number> {
  const depth = new Map<string, number>([[data.traffic.entry, 0]]);
  const queue = [data.traffic.entry];
  while (queue.length) {
    const id = queue.shift() as string;
    const component = data.components.find((c) => c.id === id);
    for (const call of component?.calls ?? []) {
      if (depth.has(call.to)) continue;
      depth.set(call.to, (depth.get(id) ?? 0) + 1);
      queue.push(call.to);
    }
  }
  return depth;
}

// Rooftops in the order requests travel; anything outside the company sits across the river.
export function layoutSkyline(data: CaseData, width: number, height: number, seed: number): Skyline {
  const sx = width / BASE.width;
  const sy = Math.min(1, height / BASE.height);
  const ground = height;
  const depth = depths(data);
  const ordered = [...data.components].sort((a, b) => (depth.get(a.id) ?? 99) - (depth.get(b.id) ?? 99));
  const inside = ordered.filter((c) => c.kind !== 'external');
  const outside = ordered.filter((c) => c.kind === 'external');
  const gap = 34;
  const riverW = outside.length ? 150 : 0;
  const naturalWidth = [...inside, ...outside].reduce((sum, c) => sum + size(c).w + gap, 0) + riverW;
  const fit = Math.min(1, (BASE.width - 120) / naturalWidth);
  let x = (BASE.width - naturalWidth * fit) / 2;

  const place = (c: Component, far: boolean): Building => {
    const { w, h } = size(c);
    const bw = w * fit * sx;
    const bh = h * sy * (far ? 0.92 : 1);
    const bx = x * sx;
    x += (w + gap) * fit;
    const rng = createRng('skyline', seed, c.id);
    const cells: Cell[] = [];
    for (let cy = ground - bh + 14; cy < ground - 10; cy += 12) {
      for (let cx = bx + 8; cx < bx + bw - 10; cx += 10) cells.push({ x: cx, y: cy, lit: rng.next() < 0.42, order: rng.next() });
    }
    return { id: c.id, kind: c.kind, x: bx, y: ground - bh, w: bw, h: bh, far, cells };
  };

  const buildings = inside.map((c) => place(c, false));
  let river: Skyline['river'] = null;
  if (outside.length) {
    river = { x: x * sx, w: riverW * fit * sx };
    x += riverW * fit;
    buildings.push(...outside.map((c) => place(c, true)));
  }

  const roof = (id: string) => {
    const b = buildings.find((bb) => bb.id === id);
    return b ? { x: b.x + b.w / 2, y: b.y } : { x: 0, y: ground };
  };
  const cables: Cable[] = data.components.flatMap((c) => c.calls.map((call) => {
    const a = roof(c.id), b = roof(call.to);
    const sag = Math.min(90, Math.abs(b.x - a.x) * 0.18) + 10;
    const mx = (a.x + b.x) / 2, my = Math.max(a.y, b.y) + sag;
    return { callId: call.id, from: c.id, to: call.to, path: `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}` };
  }));

  const hazeRng = createRng('haze', seed);
  const haze: Skyline['haze'] = [];
  for (let hx = 0; hx < width; ) {
    const w = 14 + hazeRng.next() * 34;
    haze.push({ x: hx, w, h: (40 + hazeRng.next() * 90) * sy });
    hx += w;
  }
  return { width, height, ground, buildings, cables, river, haze };
}
