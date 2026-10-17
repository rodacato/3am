import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/i18n';
import type { Focus } from '../desk/Desk';

export type TourMode = 'auto' | 'on' | 'off';

const STEPS: { id: string; zone: Focus }[] = [
  { id: 'clock', zone: 'monitor' },
  { id: 'phone', zone: 'phone' },
  { id: 'monitor', zone: 'monitor' },
  { id: 'receipts', zone: 'monitor' },
  { id: 'evidence', zone: 'window' },
  { id: 'hypotheses', zone: 'window' },
  { id: 'close', zone: 'monitor' },
];

const TABS = ['dashboards', 'metrics', 'logs', 'traces', 'changes', 'runbooks', 'actions'];

// The tour lights each zone with the same lamp the case uses, so the reader learns where to look, not just what to read.
export function Tour({ onZone, onClose }: { onZone: (zone: Focus) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const step = STEPS[index] as (typeof STEPS)[number];
  const last = index === STEPS.length - 1;

  useEffect(() => { onZone(step.zone); }, [step, onZone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(STEPS.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const params = {
    ack: t('phone.ack'),
    tabs: TABS.map((tab) => t(`monitor.tab.${tab}`)).join(' · '),
    tear: t('monitor.tear'),
    newHypothesis: t('board.newHypothesis'),
    tieHere: t('board.tieHere'),
    holds: t('board.markHolds'),
    alibi: t('board.markAlibi'),
    actions: t('monitor.tab.actions'),
    close: t('phone.close'),
    tour: t('prefs.tour'),
  };

  return (
    <div className="tour" data-zone={step.zone} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      <div className="tour__card">
        <div className="tour__kicker">{t('tour.kicker', { step: index + 1, total: STEPS.length })}</div>
        <h2 id="tour-title">{t(`tour.${step.id}.title`)}</h2>
        <p id="tour-body">{t(`tour.${step.id}.body`, params)}</p>
        <div className="tour__row">
          <button className="link link--quiet" onClick={onClose}>{t('tour.skip')}</button>
          <span className="row">
            {index > 0 && <button className="big-button big-button--ghost" onClick={() => setIndex(index - 1)}>{t('tour.back')}</button>}
            <button className="big-button" autoFocus key={step.id} onClick={() => (last ? onClose() : setIndex(index + 1))}>{last ? t('tour.done') : t('tour.next')}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
