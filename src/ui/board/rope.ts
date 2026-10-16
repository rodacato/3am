export type Point = { x: number; y: number };

export type Rope = {
  pts: Point[];
  prev: Point[];
  slack: number;
  pinnedA: boolean;
  pinnedB: boolean;
  opacity: number;
};

const SEGMENTS = 18;
const GRAVITY = 0.32;
const DAMPING = 0.93;
const ITERATIONS = 14;

export function createRope(a: Point, b: Point, slack: number): Rope {
  const pts: Point[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + Math.sin(Math.PI * t) * 30 });
  }
  return { pts, prev: pts.map((p) => ({ ...p })), slack, pinnedA: true, pinnedB: true, opacity: 1 };
}

// One verlet step toward rest; returns how far the rope moved, so callers can stop when it settles.
export function stepRope(r: Rope, a: Point, b: Point): number {
  const n = r.pts.length;
  let motion = 0;
  for (let i = 0; i < n; i++) {
    if ((i === 0 && r.pinnedA) || (i === n - 1 && r.pinnedB)) continue;
    const p = r.pts[i] as Point;
    const q = r.prev[i] as Point;
    const vx = (p.x - q.x) * DAMPING;
    const vy = (p.y - q.y) * DAMPING;
    r.prev[i] = { x: p.x, y: p.y };
    p.x += vx;
    p.y += vy + GRAVITY;
    motion += Math.abs(vx) + Math.abs(vy);
  }
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  const segment = (Math.max(span, 1) * r.slack) / (n - 1);
  for (let k = 0; k < ITERATIONS; k++) {
    if (r.pinnedA) r.pts[0] = { ...a };
    if (r.pinnedB) r.pts[n - 1] = { ...b };
    for (let i = 0; i < n - 1; i++) {
      const p = r.pts[i] as Point;
      const q = r.pts[i + 1] as Point;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const diff = (d - segment) / d;
      const lockP = i === 0 && r.pinnedA;
      const lockQ = i + 1 === n - 1 && r.pinnedB;
      const wp = lockP ? 0 : lockQ ? 1 : 0.5;
      const wq = lockQ ? 0 : lockP ? 1 : 0.5;
      p.x += dx * diff * wp;
      p.y += dy * diff * wp;
      q.x -= dx * diff * wq;
      q.y -= dy * diff * wq;
    }
  }
  return motion;
}

export function ropePath(pts: readonly Point[]): string {
  const first = pts[0];
  if (!first) return '';
  let d = `M${first.x.toFixed(1)},${first.y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i] as Point;
    const q = pts[i + 1] as Point;
    d += ` Q${p.x.toFixed(1)},${p.y.toFixed(1)} ${((p.x + q.x) / 2).toFixed(1)},${((p.y + q.y) / 2).toFixed(1)}`;
  }
  const last = pts[pts.length - 1] as Point;
  return `${d} L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
}

// Reduced motion: a fixed catenary-ish curve, no simulation.
export function staticRopePath(a: Point, b: Point, slack: number): string {
  const sag = Math.hypot(b.x - a.x, b.y - a.y) * Math.sqrt(Math.max(0, slack * slack - 1)) * 0.6;
  return `M${a.x},${a.y} Q${(a.x + b.x) / 2},${(a.y + b.y) / 2 + sag * 2} ${b.x},${b.y}`;
}
