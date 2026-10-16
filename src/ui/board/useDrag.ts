import { useRef, useState, type PointerEvent, type RefObject } from 'react';

type Drag = { startX: number; startY: number; fromX: number; fromY: number; moved: boolean };

// Drag in board fractions so positions survive resizes and focus changes.
export function useDrag(containerRef: RefObject<HTMLElement | null>, x: number, y: number, onDrop: (x: number, y: number) => void) {
  const drag = useRef<Drag | null>(null);
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button, textarea, select, input')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, fromX: x, fromY: y, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const box = containerRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = (e.clientX - d.startX) / box.width;
    const dy = (e.clientY - d.startY) / box.height;
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 4) d.moved = true;
    if (d.moved) setLive({ x: Math.min(0.92, Math.max(0, d.fromX + dx)), y: Math.min(0.9, Math.max(0, d.fromY + dy)) });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && live) onDrop(live.x, live.y);
    setLive(null);
    return d?.moved ?? false;
  };

  return { position: live ?? { x, y }, dragging: live !== null, handlers: { onPointerDown, onPointerMove, onPointerUp }, wasDrag: () => drag.current?.moved ?? false };
}
