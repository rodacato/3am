import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { useEffect, useState } from 'react';
import type { CaseData } from '../../engine/case-schema';
import { useI18n } from '../../i18n/i18n';

const NODE_W = 188;
const MIN_NODE_H = 84;
const LABEL_TOP = 22;
const LINE_H = 17.5;
// Fraunces at 14px fits about 22 characters across the label box; a generous guess beats a clipped sentence.
const CHARS_PER_LINE = 21;
const elk = new ELK();

function nodeHeight(label: string): number {
  const lines = Math.ceil(label.length / CHARS_PER_LINE);
  return Math.max(MIN_NODE_H, LABEL_TOP + lines * LINE_H + 10);
}

type Laid = { nodes: { id: string; x: number; y: number; height: number; layer: number }[]; edges: { id: string; points: { x: number; y: number }[] }[]; width: number; height: number };

const KIND_COLOR: Record<string, string> = { change: '#E0533D', condition: '#2B2823', latent: '#6B7480', symptom: '#2B2823', impact: '#E0533D' };
// The stroke colors fall under 4.5:1 as 9px text on the card; labels use darker inks of the same hue.
const KIND_TEXT: Record<string, string> = { change: '#AD3A27', condition: '#2B2823', latent: '#5D6570', symptom: '#2B2823', impact: '#AD3A27' };

// elk lays out the hidden chain from case data; nodes unfold layer by layer unless motion is reduced.
export function CausalChain({ data, named, reducedMotion }: { data: CaseData; named: Set<string>; reducedMotion: boolean }) {
  const { t } = useI18n();
  const [laid, setLaid] = useState<Laid | null>(null);

  useEffect(() => {
    const graph: ElkNode = {
      id: 'root',
      layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '26', 'elk.layered.spacing.nodeNodeBetweenLayers': '44', 'elk.edgeRouting': 'ORTHOGONAL' },
      children: data.causalChain.nodes.map((n) => ({ id: n.id, width: NODE_W, height: nodeHeight(t(`case.${n.labelKey}`)) })),
      edges: data.causalChain.edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
    };
    let live = true;
    void elk.layout(graph).then((out) => {
      if (!live) return;
      const xs = [...new Set((out.children ?? []).map((c) => c.x ?? 0))].sort((a, b) => a - b);
      setLaid({
        nodes: (out.children ?? []).map((c) => ({ id: c.id, x: c.x ?? 0, y: c.y ?? 0, height: c.height ?? MIN_NODE_H, layer: xs.indexOf(c.x ?? 0) })),
        edges: (out.edges ?? []).map((e) => {
          const s = e.sections?.[0];
          return { id: e.id, points: s ? [s.startPoint, ...(s.bendPoints ?? []), s.endPoint] : [] };
        }),
        width: out.width ?? 800,
        height: out.height ?? 300,
      });
    });
    return () => { live = false; };
  }, [data, t]);

  if (!laid) return <p className="muted">{t('debrief.drawing')}</p>;
  const nodeById = new Map(data.causalChain.nodes.map((n) => [n.id, n]));
  const delay = (layer: number) => (reducedMotion ? '0s' : `${0.35 + layer * 0.45}s`);

  return (
    <svg viewBox={`-4 -4 ${laid.width + 8} ${laid.height + 8}`} width="100%" role="img" aria-label={t('debrief.chainLabel')}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,1 L10,5 L0,9" fill="none" stroke="#2B2823" strokeWidth="1.5" />
        </marker>
        <style>{`@keyframes unfold { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }`}</style>
      </defs>
      {laid.edges.map((e) => {
        const from = laid.nodes.find((n) => data.causalChain.edges[Number(e.id.slice(1))]?.from === n.id);
        return (
          <polyline key={e.id} points={e.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#2B2823" strokeOpacity={0.55} strokeWidth={1.2} markerEnd="url(#arrow)"
            style={{ animation: reducedMotion ? undefined : `unfold .6s ${delay((from?.layer ?? 0) + 0.6)} both` }} />
        );
      })}
      {laid.nodes.map((n) => {
        const node = nodeById.get(n.id);
        if (!node) return null;
        const factor = node.factor;
        const status = factor ? (named.has(factor) ? 'named' : 'missed') : null;
        return (
          <g key={n.id} transform={`translate(${n.x},${n.y})`}>
          <g style={{ animation: reducedMotion ? undefined : `unfold .6s ${delay(n.layer)} both` }}>
            <rect width={NODE_W} height={n.height} fill="#F3EFE6" stroke={KIND_COLOR[node.kind]} strokeWidth={status === 'named' ? 2 : 1} strokeDasharray={status === 'missed' ? '4 3' : undefined} />
            <rect width={NODE_W} height={3} fill={KIND_COLOR[node.kind]} />
            <text x={10} y={17} fontFamily="IBM Plex Mono" fontSize={10} letterSpacing="0.08em" fill={KIND_TEXT[node.kind]}>
              {t(`debrief.kind.${node.kind}`).toUpperCase()}{status ? ` · ${t(`debrief.status.${status}`)}` : ''}
            </text>
            <foreignObject x={8} y={LABEL_TOP} width={NODE_W - 16} height={n.height - LABEL_TOP - 4}>
              <div style={{ fontFamily: 'var(--serif)', fontSize: 14, lineHeight: 1.22, color: '#2B2823' }}>{t(`case.${node.labelKey}`)}</div>
            </foreignObject>
          </g>
          </g>
        );
      })}
    </svg>
  );
}
