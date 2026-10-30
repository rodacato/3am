import { useMemo, useState } from 'react';
import { duePrompt } from '../../engine/incident-machine';
import { blameTerms, casePeople, reviewStatusUpdate } from '../../engine/rubric';
import { clockLabel } from '../../engine/time';
import { useI18n } from '../../i18n/i18n';
import type { Session } from '../session/useCaseSession';

type Props = { session: Session; displayClock: number; onFocus: () => void; focused: boolean };

export function Phone({ session, displayClock, onFocus, focused }: Props) {
  const { t, format } = useI18n();
  const [composing, setComposing] = useState(false);
  const { phase, context, data, pulse } = session;
  const prompt = duePrompt(context);
  const promptData = prompt ? data.stakeholderPrompts.find((p) => p.id === prompt.id) : undefined;
  const lastUpdate = context.statusUpdates[context.statusUpdates.length - 1];
  const terms = useMemo(() => blameTerms(t('rubric.blameTerms')), [t]);
  const checks = reviewStatusUpdate(session.statusDraft, terms, casePeople(data));
  const on = phase !== 'briefing';
  const sunUp = displayClock >= data.dawn.sunriseAt && context.stableAt === null;

  const send = () => {
    if (!prompt || !session.statusDraft.trim()) return;
    session.send({ type: 'SEND_STATUS', promptId: prompt.id, text: session.statusDraft.trim() });
    setComposing(false);
  };

  return (
    <section className="phone-zone" aria-label={t('phone.label')} onPointerDown={onFocus}>
      <div className="phone" data-buzz={phase === 'paged'}>
        <div className="phone__screen" data-on={on}>
          {on && (
            <div>
              <div className="phone__clock" aria-live="polite">{clockLabel(displayClock)}</div>
              <div className="phone__date">{t('case.phoneDate')}{phase !== 'paged' ? ` · ${t('phone.sincePage', { minutes: displayClock - data.page.at })}` : ''}</div>
            </div>
          )}
          {phase === 'paged' && (
            <>
              <div className="notice">
                <span className="notice__head">{t('phone.page', { clock: clockLabel(data.page.at) })}</span>
                <span>{t(`case.${data.alert.summaryKey}`)}</span>
              </div>
              <button className="big-button" onClick={() => session.send({ type: 'ACK' })} autoFocus>{t('phone.ack')}</button>
            </>
          )}
          {(phase === 'investigating' || phase === 'mitigating' || phase === 'stable') && (
            <>
              {context.stableAt === null ? (
                <div className="notice">
                  <span className="notice__head">{t('phone.paged', { clock: clockLabel(data.page.at), ack: clockLabel(context.ackAt ?? data.page.at) })}</span>
                  <span>{t(`case.${data.alert.summaryKey}`)}</span>
                </div>
              ) : (
                <div className="notice notice--ok">
                  <span className="notice__head">{t('phone.resolved', { clock: clockLabel(context.stableAt) })}</span>
                  <span>{t('phone.resolvedBody')}</span>
                  <button className="big-button notice__action" onClick={() => session.send({ type: 'WRITE_POSTMORTEM' })}>{t('phone.close')}</button>
                </div>
              )}
              {pulse && (
                <div className="users">
                  {t('phone.affected')} <strong>{format(pulse.affectedUsers)}</strong>
                  <em>{pulse.affectedLastMinute > 0 ? t('phone.climbing', { count: pulse.affectedLastMinute }) : t('phone.holding')}</em>
                </div>
              )}
              {sunUp && <div className="hint" style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 13 }}>{t('phone.sunUp')}</div>}
              {prompt && promptData && !composing && (
                <div className="notice notice--calm">
                  <span className="notice__head">{t(`case.${promptData.fromKey}`)} · {clockLabel(promptData.at)}</span>
                  <span style={{ fontFamily: 'var(--serif)', fontSize: 13.5 }}>{t(`case.${promptData.askKey}`)}</span>
                  <button className="link" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => { setComposing(true); onFocus(); }}>{t('phone.reply')}</button>
                </div>
              )}
              {prompt && composing && (
                <>
                  <textarea
                    rows={focused ? 6 : 4}
                    value={session.statusDraft}
                    onChange={(e) => session.setStatusDraft(e.target.value)}
                    placeholder={t('phone.statusPlaceholder')}
                    aria-label={t('phone.statusLabel')}
                    autoFocus
                  />
                  <ul className="checks">
                    {checks.map((c) => <li key={c.id} data-pass={c.passed === true}>{t(`rubric.${c.id}`, c.params)}</li>)}
                  </ul>
                  <div className="row">
                    <button className="big-button" onClick={send} disabled={!session.statusDraft.trim()}>{t('phone.send', { cost: data.tools.costs.statusUpdate })}</button>
                    <button className="link link--quiet" onClick={() => setComposing(false)}>{t('phone.later')}</button>
                  </div>
                </>
              )}
              {!prompt && lastUpdate && (
                <div className="hint">{t('phone.sent', { clock: clockLabel(lastUpdate.sentAt) })}</div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
