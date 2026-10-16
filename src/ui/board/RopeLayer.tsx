import { useEffect, useRef, type RefObject } from 'react';
import { createRope, ropePath, staticRopePath, stepRope, type Point, type Rope } from './rope';
import { useLatest } from '../useLatest';

export type RopeLink = { key: string; from: string; to: string; state: 'open' | 'confirmed' | 'refuted' };

type Props = { links: RopeLink[]; glassRef: RefObject<HTMLDivElement | null>; rootRef: RefObject<HTMLDivElement | null>; reducedMotion: boolean };

const SLACK = { open: 1.035, confirmed: 1.003, refuted: 1.05 } as const;
const FADE_PER_FRAME = 1 / 90;

function anchorPoint(root: HTMLElement, glass: DOMRect, id: string): Point | null {
  const el = root.querySelector(`[data-anchor="${id}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - glass.left, y: r.top + r.height / 2 - glass.top };
}

// Red string: dark shadow, thread, a thin twisted highlight.
function paint(g: SVGGElement, d: string, opacity: number) {
  g.setAttribute('opacity', opacity.toFixed(3));
  g.querySelectorAll('path').forEach((p) => p.setAttribute('d', d));
}

export function RopeLayer({ links, glassRef, rootRef, reducedMotion }: Props) {
  const ropes = useRef(new Map<string, Rope>());
  const groups = useRef(new Map<string, SVGGElement>());
  const linksRef = useLatest(links);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const glassEl = glassRef.current;
      const root = rootRef.current;
      if (!glassEl || !root) return;
      const glass = glassEl.getBoundingClientRect();
      const live = new Set<string>();
      for (const link of linksRef.current) {
        live.add(link.key);
        const g = groups.current.get(link.key);
        const a = anchorPoint(root, glass, link.from);
        const b = anchorPoint(root, glass, link.to);
        if (!g || !a || !b) continue;
        if (reducedMotion) {
          paint(g, staticRopePath(a, b, SLACK[link.state]), link.state === 'refuted' ? 0 : 1);
          continue;
        }
        let rope = ropes.current.get(link.key);
        if (!rope) {
          rope = createRope(a, b, SLACK.open);
          ropes.current.set(link.key, rope);
        }
        rope.slack += (SLACK[link.state] - rope.slack) * 0.06;
        if (link.state === 'refuted') {
          rope.pinnedB = false;
          rope.opacity = Math.max(0, rope.opacity - FADE_PER_FRAME);
        } else {
          rope.pinnedB = true;
          rope.opacity = Math.min(1, rope.opacity + FADE_PER_FRAME * 3);
        }
        stepRope(rope, a, b);
        paint(g, ropePath(rope.pts), rope.opacity);
      }
      for (const key of ropes.current.keys()) if (!live.has(key)) ropes.current.delete(key);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [glassRef, rootRef, reducedMotion, linksRef]);

  return (
    <svg className="glass__ropes" aria-hidden="true">
      {links.map((link) => (
        <g
          key={link.key}
          ref={(el) => {
            if (el) groups.current.set(link.key, el);
            else groups.current.delete(link.key);
          }}
          fill="none"
          strokeLinecap="round"
        >
          <path stroke="#000" strokeOpacity={0.35} strokeWidth={3.2} transform="translate(1.5,3)" />
          <path stroke="#E0533D" strokeWidth={1.8} />
          <path stroke="#F4A08F" strokeOpacity={0.45} strokeWidth={0.6} strokeDasharray="2 3" />
        </g>
      ))}
    </svg>
  );
}
