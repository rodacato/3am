import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaseData } from '../../engine/case-schema';
import type { ToolRequest } from '../../engine/tools';
import { clockLabel } from '../../engine/time';
import { useI18n } from '../../i18n/i18n';
import { metricUnit } from '../../query/promql/unit';
import type { MetricVocabulary } from '../../telemetry/source';
import type { Session } from '../session/useCaseSession';
import type { PinInput } from './pins';
import { TimeChart } from './TimeChart';
import { ChangesTool, DashboardsTool, LogsTool, MetricsTool, RunbooksTool, TracesTool, type RunResult } from './tools';
import { useLatest } from '../useLatest';

const TABS = ['dashboards', 'metrics', 'logs', 'traces', 'changes', 'runbooks', 'actions'] as const;
type Tab = (typeof TABS)[number];
const TAB_FOR_TOOL: Record<ToolRequest['tool'], Tab> = {
  dashboard: 'dashboards', metrics: 'metrics', logs: 'logs', traces: 'traces', trace: 'traces', changes: 'changes', runbook: 'runbooks', map: 'dashboards',
};

type Props = {
  session: Session;
  vocabulary: MetricVocabulary | null;
  pin: (p: PinInput) => void;
  onFocus: () => void;
  reopen: { id: number; nonce: number } | null;
  reducedMotion: boolean;
  onWatchClock: (minute: number | null) => void;
  displayClock: number;
};

function stripThreshold(expr: string): string {
  return expr.replace(/\s*(>|<|>=|<=|==|!=)\s*[\d.]+\s*$/, '');
}

// The editors open on the service that paged: its alert query, its warnings, and its slow or failed traces.
function firstDrafts(data: CaseData): Record<string, string> {
  const service = /service="([^"]+)"/.exec(data.alert.expr)?.[1] ?? data.traffic.entry;
  const traces = metricUnit(data.alert.expr) === 'seconds' ? `min:${data.impact.slowMs / 1000}s` : 'status:error';
  return { metrics: stripThreshold(data.alert.expr), logs: `service:${service} level:warn+`, traces: `service:${service} ${traces}` };
}

function ActionsTool({ session }: { session: Session }) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState<string | null>(null);
  const tried = new Set(session.context.mitigations.map((m) => m.id));
  return (
    <div className="scroll">
      <div className="hint" style={{ marginBottom: 6 }}>{t('actions.hint')}</div>
      {session.data.mitigations.map((m) => (
        <div key={m.id} className="action">
          <span className="action__title">{t(`case.mitigation.${m.id}.title`)} <span className="hint">· −{m.costMin} MIN{tried.has(m.id) ? ` · ${t('actions.tried')}` : ''}</span></span>
          <span className="action__what">{t(`case.mitigation.${m.id}.what`)}</span>
          {confirming === m.id ? (
            <span className="row">
              <button className="run" onClick={() => { setConfirming(null); session.send({ type: 'MITIGATE', mitigationId: m.id, costMin: m.costMin }); }}>{t('actions.go')}</button>
              <button className="link link--quiet" onClick={() => setConfirming(null)}>{t('actions.notYet')}</button>
            </span>
          ) : (
            <button className="run" disabled={session.phase !== 'investigating'} onClick={() => setConfirming(m.id)}>{t('actions.do')} · −{m.costMin} MIN</button>
          )}
        </div>
      ))}
    </div>
  );
}

const WATCH_MS = 4800;
const WATCH_FAIL_MIN = 5;

// The wow moment: the chart redraws minute by minute while the clock runs, and either bends back or doesn't.
function WatchPanel({ session, reducedMotion, onWatchClock }: { session: Session; reducedMotion: boolean; onWatchClock: (m: number | null) => void }) {
  const { t } = useI18n();
  const pending = session.context.pendingMitigation;
  const [view, setView] = useState<{ times: number[]; values: (number | null)[]; end: number; clearsAt: number | null } | null>(null);
  const [reveal, setReveal] = useState<number | null>(null);
  const sent = useRef(false);
  const sessionRef = useLatest(session);

  useEffect(() => {
    if (!pending) return;
    let live = true;
    const session = sessionRef.current;
    (async () => {
      const clearsAt = await session.observeMitigation();
      const end = clearsAt ?? pending.effectiveAt + WATCH_FAIL_MIN;
      const response = await session.previewQuery({ tool: 'metrics', query: stripThreshold(session.data.alert.expr), fromMin: pending.startedAt - 30, toMin: end }, end);
      if (!live || !response.ok || response.data.tool !== 'metrics') return;
      const result = response.data.panel.result;
      setView({ times: result.times, values: result.series[0]?.values ?? [], end, clearsAt });
    })();
    return () => { live = false; };
  }, [pending, sessionRef]);

  useEffect(() => {
    if (!view || !pending) return;
    const finish = () => {
      if (sent.current) return;
      sent.current = true;
      onWatchClock(null);
      sessionRef.current.send({ type: 'MITIGATION_OBSERVED', clearsAt: view.clearsAt, watchedMin: view.clearsAt === null ? WATCH_FAIL_MIN : 0 });
    };
    if (reducedMotion) {
      const shown = setTimeout(() => setReveal(view.end), 0);
      const id = setTimeout(finish, 1200);
      return () => { clearTimeout(shown); clearTimeout(id); };
    }
    const start = performance.now();
    const from = pending.startedAt;
    let frame = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / WATCH_MS);
      const minute = Math.round(from + (view.end - from) * k);
      setReveal(minute);
      onWatchClock(minute);
      if (k < 1) frame = requestAnimationFrame(tick);
      else setTimeout(finish, 900);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [view, pending, reducedMotion, onWatchClock, sessionRef]);

  if (!pending) return null;
  const done = view !== null && reveal === view.end;
  return (
    <div className="watch">
      <div className="watch__line">{t(`case.mitigation.${pending.id}.doing`)}</div>
      <div className="hint">{t('watch.cost', { start: clockLabel(pending.startedAt), end: clockLabel(pending.effectiveAt) })}</div>
      {view ? (
        <TimeChart
          times={view.times}
          series={[{ label: t(`case.${session.data.alert.summaryKey}`), values: view.values }]}
          unit={metricUnit(session.data.alert.expr)}
          height={170}
          revealUpTo={reveal ?? pending.startedAt}
          markers={[{ minute: pending.effectiveAt, color: '#F2A541' }]}
        />
      ) : <div className="hint">{t('watch.loading')}</div>}
      {done && <div className="watch__line">{view.clearsAt !== null ? t('watch.cleared', { clock: clockLabel(view.clearsAt) }) : t('watch.nothing', { minutes: WATCH_FAIL_MIN })}</div>}
    </div>
  );
}

export function Monitor({ session, vocabulary, pin, onFocus, reopen, reducedMotion, onWatchClock, displayClock }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('dashboards');
  const [last, setLast] = useState<Partial<Record<Tab, RunResult>>>({});
  const [tracesList, setTracesList] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => firstDrafts(session.data));
  const [flash, setFlash] = useState<number | null>(null);
  const live = session.phase === 'investigating' || session.phase === 'stable';

  const run = useCallback(async (request: ToolRequest) => {
    setBusy(true);
    try {
      const result = await session.runQuery(request);
      const target = TAB_FOR_TOOL[request.tool];
      setLast((prev) => ({ ...prev, [target]: result }));
      if (request.tool === 'traces') setTracesList(result);
      if (result.response.ok) setFlash(result.response.costMin);
      return result;
    } finally {
      setBusy(false);
    }
  }, [session]);

  useEffect(() => {
    if (!reopen) return;
    const entry = session.context.queries.find((q) => q.id === reopen.id);
    if (!entry) return;
    const target = TAB_FOR_TOOL[entry.request.tool];
    void session.reopenQuery(reopen.id).then((response) => {
      setTab(target);
      if (response) setLast((prev) => ({ ...prev, [target]: { id: reopen.id, response } }));
    });
    // Only a new reopen request should trigger this, not every session update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reopen]);

  useEffect(() => {
    if (flash === null) return;
    const id = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(id);
  }, [flash]);

  const common = {
    session, run, busy, pin, vocabulary,
    openInMetrics: (query: string) => { setDrafts((d) => ({ ...d, metrics: query })); setTab('metrics'); },
  };
  const draftFor = (key: string) => ({ draft: drafts[key] ?? '', setDraft: (v: string) => setDrafts((d) => ({ ...d, [key]: v })) });

  return (
    <section className="monitor" aria-label={t('monitor.label')} onPointerDown={onFocus} onFocus={onFocus}>
      <div className="monitor__screen">
        <div className="monitor__bar" role="tablist">
          {TABS.map((name) => (
            <button key={name} role="tab" className="tab" aria-selected={tab === name} disabled={!live} onClick={() => setTab(name)}>
              {t(`monitor.tab.${name}`)}
            </button>
          ))}
          <span className="monitor__clock">
            {flash !== null && <span style={{ color: 'var(--amber)', marginRight: 10 }}>−{flash} MIN</span>}
            {clockLabel(displayClock)}
          </span>
        </div>
        <div className="monitor__body">
          {session.phase === 'briefing' || session.phase === 'paged' ? (
            <div className="monitor__off">{t('monitor.locked')}</div>
          ) : session.phase === 'mitigating' ? (
            <WatchPanel session={session} reducedMotion={reducedMotion} onWatchClock={onWatchClock} />
          ) : (
            <>
              {tab === 'dashboards' && <DashboardsTool {...common} last={last.dashboards ?? null} {...draftFor('dashboards')} />}
              {tab === 'metrics' && <MetricsTool {...common} last={last.metrics ?? null} {...draftFor('metrics')} />}
              {tab === 'logs' && <LogsTool {...common} last={last.logs ?? null} {...draftFor('logs')} />}
              {tab === 'traces' && <TracesTool {...common} last={last.traces ?? null} list={tracesList} {...draftFor('traces')} onBack={() => setLast((p) => ({ ...p, traces: tracesList ?? undefined }))} />}
              {tab === 'changes' && <ChangesTool {...common} last={last.changes ?? null} {...draftFor('changes')} />}
              {tab === 'runbooks' && <RunbooksTool {...common} last={last.runbooks ?? null} {...draftFor('runbooks')} />}
              {tab === 'actions' && <ActionsTool session={session} />}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
