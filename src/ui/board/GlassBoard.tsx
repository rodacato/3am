import { useMemo, useRef, useState, type RefObject } from 'react';
import type { Hypothesis, Pin } from '../../engine/board';
import type { CaseData } from '../../engine/case-schema';
import { clockLabel } from '../../engine/time';
import { useI18n } from '../../i18n/i18n';
import type { BoardAction } from '../session/board-reducer';
import { RopeLayer, type RopeLink } from './RopeLayer';
import { useDrag } from './useDrag';

type Props = {
  data: CaseData;
  pins: Pin[];
  hypotheses: Hypothesis[];
  dispatch: (a: BoardAction) => void;
  selectedPin: string | null;
  onSelectPin: (id: string | null) => void;
  rootRef: RefObject<HTMLDivElement | null>;
  reducedMotion: boolean;
  enabled: boolean;
  onFocus: () => void;
};

function Sparkline({ values, highlight }: { values: number[]; highlight: [number, number] | null }) {
  const w = 178, h = 34;
  const max = Math.max(...values, 1e-9);
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * w;
  const y = (v: number) => h - 2 - (v / max) * (h - 4);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} aria-hidden="true">
      {highlight && <rect x={x(highlight[0])} y={0} width={Math.max(2, x(highlight[1]) - x(highlight[0]))} height={h} fill="#F2A541" fillOpacity={0.35} />}
      <line x1={0} x2={w} y1={h - 1} y2={h - 1} stroke="#2B2823" strokeOpacity={0.25} />
      <path d={d} fill="none" stroke="#2B2823" strokeWidth={1.3} />
    </svg>
  );
}

function Slip({ pin, containerRef, dispatch, selected, onSelect }: { pin: Pin; containerRef: RefObject<HTMLDivElement | null>; dispatch: Props['dispatch']; selected: boolean; onSelect: () => void }) {
  const { t } = useI18n();
  const { position, handlers } = useDrag(containerRef, pin.x, pin.y, (x, y) => dispatch({ type: 'move', id: pin.id, x, y }));
  return (
    <div
      className="slip"
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={t('board.slipLabel', { line: pin.lines[0] ?? '' })}
      style={{ left: `min(${position.x * 100}%, calc(100% - 210px))`, top: `${position.y * 100}%`, rotate: `${pin.rot}deg` }}
      {...handlers}
      onPointerUp={() => { if (!handlers.onPointerUp()) onSelect(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
    >
      <span className="tape" />
      <span data-anchor={`pin-${pin.id}`} style={{ position: 'absolute', right: 12, top: 10, width: 1, height: 1 }} />
      <span className="pinhead" style={{ left: 'auto', right: 7, top: 10 }} />
      <div className="slip__head">
        Q-{String(pin.source.queryId).padStart(2, '0')} · {t(`tool.${pin.source.tool}`).toUpperCase()} · −{pin.source.costMin} MIN · {clockLabel(pin.source.ranAt)}
      </div>
      {pin.lines.map((line, i) => <div key={i} className="slip__line" title={line}>{line}</div>)}
      {pin.sparkline && <Sparkline values={pin.sparkline} highlight={pin.highlight} />}
      <button className="slip__x" onClick={() => dispatch({ type: 'unpin', pinId: pin.id })} aria-label={t('board.unpin')}>×</button>
    </div>
  );
}

function HypothesisCard({ h, index, data, containerRef, dispatch, tieMode, onTie, startEditing }: {
  h: Hypothesis; index: number; data: CaseData; containerRef: RefObject<HTMLDivElement | null>; dispatch: Props['dispatch']; tieMode: boolean; onTie: () => void; startEditing: boolean;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(startEditing);
  const [text, setText] = useState(h.text);
  const [accuses, setAccuses] = useState(h.accuses ?? '');
  const { position, handlers } = useDrag(containerRef, h.x, h.y, (x, y) => dispatch({ type: 'move', id: h.id, x, y }));
  const save = () => {
    if (!text.trim()) return;
    dispatch({ type: 'edit', id: h.id, text: text.trim(), accuses: accuses || null });
    setEditing(false);
  };
  const head = h.status === 'confirmed' ? t('board.holds') : h.status === 'refuted' ? t('board.alibi') : t('board.open');
  return (
    <div
      className="hypothesis"
      data-status={h.status}
      data-tie={tieMode}
      style={{ left: `min(${position.x * 100}%, calc(100% - 248px))`, top: `${position.y * 100}%`, rotate: h.status === 'refuted' ? '-5deg' : `${index % 2 ? 1.2 : -1}deg`, translate: h.status === 'refuted' ? '0 10px' : undefined }}
      {...handlers}
      onPointerUp={(e) => {
        const moved = handlers.onPointerUp();
        if (!moved && tieMode && !(e.target as HTMLElement).closest('button, textarea, select')) onTie();
      }}
    >
      <span data-anchor={`hyp-${h.id}`} style={{ position: 'absolute', left: 8, top: 14, width: 1, height: 1 }} />
      <span className="pinhead" style={{ left: 8, top: 14 }} />
      <span data-anchor={`hyp-${h.id}-foot`} style={{ position: 'absolute', left: '50%', bottom: 0, width: 1, height: 1 }} />
      <div className="hypothesis__head">
        H{index + 1} · {head}{h.accuses ? ` · ${t('board.accuses', { component: h.accuses })}` : ''}
      </div>
      {editing ? (
        <>
          <textarea rows={3} value={text} autoFocus placeholder={t('board.hypothesisPlaceholder')} onChange={(e) => setText(e.target.value)} aria-label={t('board.hypothesisText')} />
          <select value={accuses} onChange={(e) => setAccuses(e.target.value)} aria-label={t('board.accusesLabel')}>
            <option value="">{t('board.accusesNobody')}</option>
            {data.components.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
          </select>
          <div className="hypothesis__row" style={{ marginTop: 8 }}>
            <button onClick={save}>{t('board.save')}</button>
            {h.text && <button onClick={() => setEditing(false)}>{t('board.cancel')}</button>}
          </div>
        </>
      ) : (
        <>
          <div className="hypothesis__text">{h.text}</div>
          <div className="hypothesis__row">
            <span>{t('board.pieces', { count: h.pins.length })}</span>
            {tieMode && <button onClick={onTie}>{t('board.tieHere')}</button>}
            {h.status !== 'confirmed' && <button onClick={() => dispatch({ type: 'status', id: h.id, status: 'confirmed' })}>{t('board.markHolds')}</button>}
            {h.status !== 'refuted' && <button onClick={() => dispatch({ type: 'status', id: h.id, status: 'refuted' })}>{t('board.markAlibi')}</button>}
            {h.status !== 'open' && <button onClick={() => dispatch({ type: 'status', id: h.id, status: 'open' })}>{t('board.reopen')}</button>}
            <button onClick={() => setEditing(true)}>{t('board.edit')}</button>
          </div>
        </>
      )}
    </div>
  );
}

export function GlassBoard({ data, pins, hypotheses, dispatch, selectedPin, onSelectPin, rootRef, reducedMotion, enabled, onFocus }: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [newId, setNewId] = useState<string | null>(null);

  const links = useMemo<RopeLink[]>(() => {
    const out: RopeLink[] = [];
    for (const h of hypotheses) {
      const state = h.status;
      for (const pinId of h.pins) if (pins.some((p) => p.id === pinId)) out.push({ key: `${pinId}>${h.id}`, from: `pin-${pinId}`, to: `hyp-${h.id}`, state });
      if (h.accuses) out.push({ key: `${h.id}>${h.accuses}`, from: `hyp-${h.id}-foot`, to: `bldg-${h.accuses}`, state });
    }
    return out;
  }, [hypotheses, pins]);

  const addHypothesis = () => {
    const id = `h${Date.now().toString(36)}`;
    dispatch({ type: 'hypothesis', hypothesis: { id, text: '', accuses: null } });
    onSelectPin(null);
    setNewId(id);
    onFocus();
  };

  return (
    <div className="glass" ref={containerRef} onPointerDown={onFocus}>
      {enabled && (
        <div className="glass__tools">
          {selectedPin && <span className="hint" style={{ color: 'var(--amber)' }}>{t('board.tieHint')}</span>}
          <button onClick={addHypothesis}>{t('board.newHypothesis')}</button>
        </div>
      )}
      {enabled && pins.length === 0 && hypotheses.length === 0 && <div className="glass__empty">{t('board.empty')}</div>}
      <RopeLayer links={links} glassRef={containerRef} rootRef={rootRef} reducedMotion={reducedMotion} />
      {pins.map((pin) => (
        <Slip key={pin.id} pin={pin} containerRef={containerRef} dispatch={dispatch} selected={selectedPin === pin.id} onSelect={() => onSelectPin(selectedPin === pin.id ? null : pin.id)} />
      ))}
      {hypotheses.map((h, i) => (
        <HypothesisCard
          key={h.id}
          h={h}
          index={i}
          data={data}
          containerRef={containerRef}
          dispatch={dispatch}
          tieMode={selectedPin !== null}
          startEditing={h.id === newId || !h.text}
          onTie={() => { if (selectedPin) { dispatch({ type: 'tie', hypothesisId: h.id, pinId: selectedPin }); onSelectPin(null); } }}
        />
      ))}
    </div>
  );
}
