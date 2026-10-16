import { useMemo, useState } from 'react';
import type { ActionItemType, Postmortem } from '../../engine/board';
import { hashSeed } from '../../engine/random';
import { blameTerms, reviewPostmortem } from '../../engine/rubric';
import { clockLabel } from '../../engine/time';
import { useI18n } from '../../i18n/i18n';
import type { Session } from '../session/useCaseSession';

const ACTION_TYPES: ActionItemType[] = ['prevent', 'detect', 'mitigate', 'process'];

export function PostmortemSheet({ session, onSubmit }: { session: Session; onSubmit: () => void }) {
  const { t, format } = useI18n();
  const { data, context, postmortem: pm, setPostmortem, seed, pulse } = session;
  const [reviewed, setReviewed] = useState(false);
  const [selfChecks, setSelfChecks] = useState<Record<string, boolean>>({});
  const set = (patch: Partial<Postmortem>) => setPostmortem({ ...pm, ...patch });

  const deck = useMemo(() => {
    const cards = [...data.factors.map((f) => ({ id: f.id, textKey: f.textKey })), ...data.distractorFactors];
    return cards.sort((a, b) => hashSeed(seed, a.id) - hashSeed(seed, b.id));
  }, [data, seed]);

  const review = useMemo(() => reviewPostmortem(data, pm, blameTerms(t('rubric.blameTerms'))), [data, pm, t]);

  const draftTimeline = () => {
    const lines = [
      `${clockLabel(data.page.at)} ${t('pm.tl.paged')}`,
      `${clockLabel(context.ackAt ?? data.page.at)} ${t('pm.tl.ack')}`,
      ...context.mitigations.map((m) => `${clockLabel(m.startedAt)} ${t(`case.mitigation.${m.id}.title`)}`),
      ...(context.stableAt !== null ? [`${clockLabel(context.stableAt)} ${t('pm.tl.stable')}`] : []),
    ];
    set({ timeline: [pm.timeline.trim(), ...lines].filter(Boolean).join('\n') });
  };

  const toggleFactor = (id: string) => set({ factors: pm.factors.includes(id) ? pm.factors.filter((f) => f !== id) : [...pm.factors, id] });

  return (
    <div className="overlay">
      <article className="sheet" aria-labelledby="pm-title">
        <div className="kicker">{t('pm.kicker')}</div>
        <h1 id="pm-title">{t('pm.title', { title: t('case.title') })}</h1>
        <p className="muted">{t('pm.lede')}</p>

        <h2>{t('pm.summary')}</h2>
        <textarea rows={2} value={pm.summary} onChange={(e) => set({ summary: e.target.value })} aria-label={t('pm.summary')} />

        <h2>{t('pm.timeline')}</h2>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: 13 }}>{t('pm.timelineHint')}</span>
          <button className="big-button big-button--ghost" onClick={draftTimeline}>{t('pm.draftTimeline')}</button>
        </div>
        <textarea className="mono-field" rows={6} value={pm.timeline} onChange={(e) => set({ timeline: e.target.value })} aria-label={t('pm.timeline')} />

        <h2>{t('pm.impact')}</h2>
        <p className="muted" style={{ fontSize: 13.5 }}>
          {t('pm.impactFacts', { minutes: (context.stableAt ?? context.clock) - data.page.at, users: format(pulse?.affectedUsers ?? 0) })}
        </p>
        <textarea rows={2} value={pm.impact} onChange={(e) => set({ impact: e.target.value })} aria-label={t('pm.impact')} />

        <h2>{t('pm.factors')}</h2>
        <p className="muted" style={{ fontSize: 13.5 }}>{t('pm.factorsHint')}</p>
        <div className="factor-deck">
          {deck.map((card) => (
            <button key={card.id} className="factor-card" aria-pressed={pm.factors.includes(card.id)} onClick={() => toggleFactor(card.id)}>
              {t(`case.${card.textKey}`)}
            </button>
          ))}
        </div>
        <input type="text" style={{ marginTop: 10 }} value={pm.customFactor} placeholder={t('pm.customFactor')} onChange={(e) => set({ customFactor: e.target.value })} aria-label={t('pm.customFactor')} />

        <h2>{t('pm.wentWell')}</h2>
        <textarea rows={2} value={pm.wentWell} onChange={(e) => set({ wentWell: e.target.value })} aria-label={t('pm.wentWell')} />

        <h2>{t('pm.actions')}</h2>
        {pm.actionItems.map((item, i) => (
          <div key={i} className="action-item">
            <input type="text" value={item.text} placeholder={t('pm.actionText')} aria-label={t('pm.actionText')}
              onChange={(e) => set({ actionItems: pm.actionItems.map((a, j) => (j === i ? { ...a, text: e.target.value } : a)) })} />
            <select value={item.type ?? ''} aria-label={t('pm.actionType')}
              onChange={(e) => set({ actionItems: pm.actionItems.map((a, j) => (j === i ? { ...a, type: (e.target.value || null) as ActionItemType | null } : a)) })}>
              <option value="">{t('pm.actionType')}</option>
              {ACTION_TYPES.map((type) => <option key={type} value={type}>{t(`pm.type.${type}`)}</option>)}
            </select>
            <input type="text" value={item.owner} placeholder={t('pm.actionOwner')} aria-label={t('pm.actionOwner')}
              onChange={(e) => set({ actionItems: pm.actionItems.map((a, j) => (j === i ? { ...a, owner: e.target.value } : a)) })} />
          </div>
        ))}
        <button className="big-button big-button--ghost" onClick={() => set({ actionItems: [...pm.actionItems, { text: '', type: null, owner: '' }] })}>{t('pm.addAction')}</button>

        {reviewed && (
          <section aria-live="polite" style={{ marginTop: 26, borderTop: '1px solid rgba(43,40,35,.25)', paddingTop: 10 }}>
            <h2>{t('pm.reviewTitle')}</h2>
            <p className="muted" style={{ fontSize: 13.5 }}>{t('pm.reviewLede')}</p>
            <ul className="margin-notes">
              {review.filter((r) => r.kind === 'auto').map((r) => (
                <li key={r.id} data-pass={r.passed === true}>{t(`rubric.${r.id}.${r.passed ? 'pass' : 'fail'}`, r.params)}</li>
              ))}
            </ul>
            <ul className="margin-notes">
              {review.filter((r) => r.kind === 'self').map((r) => (
                <li key={r.id} data-pass={selfChecks[r.id] === true}>
                  <label className="row" style={{ gap: 8 }}>
                    <input type="checkbox" checked={selfChecks[r.id] ?? false} onChange={(e) => setSelfChecks({ ...selfChecks, [r.id]: e.target.checked })} />
                    {t(`rubric.${r.id}`)}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="row" style={{ marginTop: 22, justifyContent: 'flex-end' }}>
          {!reviewed ? (
            <button className="big-button" onClick={() => setReviewed(true)}>{t('pm.review')}</button>
          ) : (
            <>
              <button className="big-button big-button--ghost" onClick={() => setReviewed(false)}>{t('pm.keepEditing')}</button>
              <button className="big-button" onClick={onSubmit}>{t('pm.file')}</button>
            </>
          )}
        </div>
      </article>
    </div>
  );
}
