import { useCallback, useEffect, useRef, useState } from 'react';
import { clockLabel } from '../../engine/time';
import { LOCALES, useI18n } from '../../i18n/i18n';
import type { MetricVocabulary } from '../../telemetry/source';
import { GlassBoard } from '../board/GlassBoard';
import { Monitor } from '../monitor/Monitor';
import type { PinInput } from '../monitor/pins';
import { CaseFolder } from '../overlays/CaseFolder';
import { Debrief } from '../overlays/Debrief';
import { PostmortemSheet } from '../overlays/PostmortemSheet';
import type { CaseProgress } from '../persistence';
import type { Session } from '../session/useCaseSession';
import { playPage } from '../sound';
import { dawnProgress, skyGradient } from '../window/sky';
import { Skyline } from '../window/Skyline';
import { Phone } from './Phone';
import { PrintTray } from './PrintTray';
import { useLatest } from '../useLatest';

export type Focus = 'window' | 'monitor' | 'phone';

type Props = {
  session: Session;
  caseNumber: number;
  vocabulary: MetricVocabulary | null;
  progress: CaseProgress | undefined;
  locale: string;
  sound: boolean;
  reducedMotion: boolean;
  onLocale: (code: string) => void;
  onSound: (on: boolean) => void;
  onReplay: () => void;
  onReset: () => void;
  onStarted: () => void;
  onCompleted: () => void;
};

export function Desk(props: Props) {
  const { session, reducedMotion, sound } = props;
  const { t } = useI18n();
  const { phase, context, data } = session;
  const windowRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<Focus>(phase === 'paged' ? 'phone' : 'monitor');
  const [lit, setLit] = useState<'false' | 'flicker' | 'true'>(phase === 'briefing' || phase === 'paged' ? 'false' : 'true');
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [reopen, setReopen] = useState<{ id: number; nonce: number } | null>(null);
  const [watchClock, setWatchClock] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const previous = useRef(phase);
  const onCompleted = useLatest(props.onCompleted);

  useEffect(() => {
    const before = previous.current;
    previous.current = phase;
    if (phase === 'paged' && before !== 'paged') {
      const timer = setTimeout(() => setFocus('phone'), 0);
      if (sound) playPage();
      return () => clearTimeout(timer);
    }
    if (before === 'paged' && phase === 'investigating') {
      // The lamp hesitates once before it holds, unless motion is reduced.
      const steps: [number, () => void][] = reducedMotion
        ? [[0, () => { setFocus('monitor'); setLit('true'); }]]
        : [[0, () => { setFocus('monitor'); setLit('flicker'); }], [90, () => setLit('false')], [260, () => setLit('true')]];
      const timers = steps.map(([ms, fn]) => setTimeout(fn, ms));
      return () => timers.forEach(clearTimeout);
    }
    if (phase === 'debrief' && before !== 'debrief') onCompleted.current();
    // Only phase transitions drive these effects; preferences are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const pin = useCallback((p: PinInput) => {
    session.dispatch({ type: 'pin', pin: p });
    setSelectedPin(p.id);
  }, [session]);

  const displayClock = watchClock ?? context.clock;
  const dawn = reducedMotion ? dawnProgress(context.clock, data.dawn.beginsAt, data.dawn.sunriseAt) : dawnProgress(displayClock, data.dawn.beginsAt, data.dawn.sunriseAt);
  const boardEnabled = phase !== 'briefing' && phase !== 'paged';
  const focusWindow = useCallback(() => setFocus('window'), []);
  const focusMonitor = useCallback(() => setFocus('monitor'), []);
  const focusPhone = useCallback(() => setFocus('phone'), []);

  return (
    <div className="room" data-focus={reducedMotion ? 'monitor' : focus} data-lit={lit} data-phase={phase}>
      <div className="window" ref={windowRef} aria-label={t('window.label')}>
        <div className="window__glass" style={{ background: skyGradient(dawn), transition: reducedMotion ? undefined : 'background 1.5s linear' }}>
          <Skyline data={data} seed={session.seed} pulse={session.pulse} dawn={dawn} reducedMotion={reducedMotion} />
          <div className="window__frame" aria-hidden="true">
            <i style={{ left: '33.2%', top: 0, bottom: 0, width: 9 }} />
            <i style={{ left: '66.4%', top: 0, bottom: 0, width: 9 }} />
            <i style={{ left: 0, right: 0, top: '38%', height: 8 }} />
          </div>
          <GlassBoard
            data={data}
            pins={session.board.pins}
            hypotheses={session.board.hypotheses}
            dispatch={session.dispatch}
            selectedPin={selectedPin}
            onSelectPin={setSelectedPin}
            rootRef={windowRef}
            reducedMotion={reducedMotion}
            enabled={boardEnabled}
            onFocus={focusWindow}
          />
        </div>
      </div>
      <div className="sill">
        <span className="sill__caption">{t('sill.caption', { title: t('case.title'), clock: clockLabel(displayClock) })}</span>
        <span className="sill__controls">
          {LOCALES.map((l) => (
            <button key={l.code} aria-pressed={props.locale === l.code} onClick={() => props.onLocale(l.code)} aria-label={l.name}>{l.short}</button>
          ))}
          <button aria-pressed={sound} onClick={() => props.onSound(!sound)}>{sound ? t('prefs.soundOn') : t('prefs.soundOff')}</button>
          <button onClick={() => setConfirmReset(true)}>{t('prefs.reset')}</button>
        </span>
      </div>
      <div className="desk">
        <Monitor
          session={session}
          vocabulary={props.vocabulary}
          pin={pin}
          onFocus={focusMonitor}
          reopen={reopen}
          reducedMotion={reducedMotion}
          onWatchClock={setWatchClock}
          displayClock={displayClock}
        />
        <PrintTray queries={context.queries} current={reopen?.id ?? null} onReopen={(id) => setReopen({ id, nonce: Date.now() })} />
        <Phone session={session} displayClock={displayClock} onFocus={focusPhone} focused={focus === 'phone'} />
      </div>
      <div className="lamp" aria-hidden="true" />

      {phase === 'briefing' && (
        <CaseFolder
          caseNumber={props.caseNumber}
          progress={props.progress}
          locale={props.locale}
          sound={sound}
          onLocale={props.onLocale}
          onSound={props.onSound}
          onReplay={props.onReplay}
          onStart={() => { session.send({ type: 'START' }); props.onStarted(); }}
        />
      )}
      {phase === 'postmortem' && <PostmortemSheet session={session} onSubmit={() => session.send({ type: 'SUBMIT_POSTMORTEM' })} />}
      {phase === 'debrief' && <Debrief session={session} reducedMotion={reducedMotion} onReplay={props.onReplay} onReset={() => setConfirmReset(true)} />}
      {confirmReset && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="reset-q">
          <div className="confirm">
            <p id="reset-q">{t('reset.question')}</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="big-button big-button--ghost" style={{ color: 'var(--ink)', borderColor: 'rgba(43,40,35,.4)' }} onClick={() => setConfirmReset(false)} autoFocus>{t('reset.keep')}</button>
              <button className="big-button" style={{ background: 'var(--red)', color: 'var(--paper)' }} onClick={() => { setConfirmReset(false); props.onReset(); }}>{t('reset.confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
