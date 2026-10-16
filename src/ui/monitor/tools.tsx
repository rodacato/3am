import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef } from 'react';
import type { ToolName } from '../../engine/case-schema';
import { clockLabel, clockLabelSeconds } from '../../engine/time';
import type { ToolError, ToolRequest, ToolResponse } from '../../engine/tools';
import { useI18n } from '../../i18n/i18n';
import type { Span } from '../../telemetry/otel';
import type { MetricVocabulary } from '../../telemetry/source';
import type { Session } from '../session/useCaseSession';
import { changePin, describeChange, labelText, logPin, metricPin, runbookPin, spanPin, type PinInput, type PinSource } from './pins';
import { PromQLEditor } from './PromQLEditor';
import { TimeChart, type Unit } from './TimeChart';

export type RunResult = { id: number; response: ToolResponse };

export type ToolProps = {
  session: Session;
  run: (request: ToolRequest) => Promise<RunResult | null>;
  busy: boolean;
  last: RunResult | null;
  pin: (p: PinInput) => void;
  vocabulary: MetricVocabulary | null;
  draft: string;
  setDraft: (v: string) => void;
  openInMetrics: (query: string) => void;
};

function sourceOf(session: Session, result: RunResult, tool: ToolName): PinSource {
  const entry = session.context.queries.find((q) => q.id === result.id);
  return { tool, queryId: result.id, ranAt: entry?.ranAt ?? result.response.ranAt, costMin: entry?.costMin ?? result.response.costMin };
}

export function ErrorLine({ error }: { error: ToolError }) {
  const { t } = useI18n();
  return (
    <div className="error-line" role="alert">
      {t(`error.${error.kind}.${error.code}`, { detail: error.detail })} {error.detail && <em>[{error.detail}]</em>}
    </div>
  );
}

function Run({ cost, busy, onRun, label }: { cost: number; busy: boolean; onRun: () => void; label: string }) {
  const { t } = useI18n();
  return (
    <button className="run" disabled={busy} onClick={onRun}>
      {busy ? t('monitor.running') : `${label} · −${cost} MIN`}
    </button>
  );
}

function seriesFor(result: { labels: Readonly<Record<string, string>>; values: (number | null)[] }[], fallback: string) {
  return result.map((s) => ({ label: labelText(s.labels) || fallback, values: s.values }));
}

function MetricsPanel({ title, unit, panel, height, onPin }: { title: string; unit: Unit; panel: { query: string; result: { times: number[]; series: { labels: Readonly<Record<string, string>>; values: (number | null)[] }[] } }; height: number; onPin: (from: number, to: number) => void }) {
  const { t } = useI18n();
  const series = useMemo(() => seriesFor(panel.result.series, title), [panel, title]);
  if (!series.length) return <div className="hint">{t('metrics.noSeries')}</div>;
  return <TimeChart times={panel.result.times} series={series} unit={unit} height={height} onSelect={onPin} />;
}

function guessUnit(query: string): Unit {
  if (/histogram_quantile|_seconds(?!_count)/.test(query)) return 'seconds';
  if (/cpu_utilization|_ratio/.test(query) && !/rate\(/.test(query)) return 'ratio';
  if (/_bytes/.test(query)) return 'bytes';
  if (/rate\(/.test(query)) return 'rps';
  return 'count';
}

export function MetricsTool({ session, run, busy, last, pin, vocabulary, draft, setDraft }: ToolProps) {
  const { t } = useI18n();
  const cost = session.data.tools.costs.metrics;
  const doRun = () => { if (draft.trim()) void run({ tool: 'metrics', query: draft }); };
  const r = last?.response;
  return (
    <>
      <div className="query-row">
        <PromQLEditor value={draft} onChange={setDraft} onRun={doRun} vocabulary={vocabulary} placeholder={t('metrics.placeholder')} label={t('metrics.editorLabel')} />
        <Run cost={cost} busy={busy} onRun={doRun} label={t('monitor.run')} />
      </div>
      <div className="hint">{t('metrics.subset')}</div>
      {r && !r.ok && <ErrorLine error={r.error} />}
      {r?.ok && r.data.tool === 'metrics' && last && (
        <div className="scroll">
          <div className="result-head">
            <span>{t('monitor.ranAt', { clock: clockLabel(r.ranAt), cost: r.costMin })}</span>
            <span>{t('metrics.dragToPin')}</span>
          </div>
          <MetricsPanel
            title={r.data.panel.query.slice(0, 70)}
            unit={guessUnit(r.data.panel.query)}
            panel={r.data.panel}
            height={170}
            onPin={(from, to) => r.data.tool === 'metrics' && pin(metricPin(r.data.panel, from, to, guessUnit(r.data.panel.query), r.data.panel.query.slice(0, 64), sourceOf(session, last, 'metrics')))}
          />
        </div>
      )}
    </>
  );
}

export function DashboardsTool({ session, run, busy, last, pin, openInMetrics }: ToolProps) {
  const { t } = useI18n();
  const dashboards = session.data.tools.dashboards;
  const r = last?.response;
  return (
    <>
      <div className="row">
        {dashboards.map((d) => (
          <Run key={d.id} cost={session.data.tools.costs.dashboard} busy={busy} onRun={() => void run({ tool: 'dashboard', dashboard: d.id })} label={t(`case.${d.titleKey}`)} />
        ))}
      </div>
      {r && !r.ok && <ErrorLine error={r.error} />}
      {r?.ok && r.data.tool === 'dashboard' && last && (() => {
        const data = r.data;
        const dashboard = dashboards.find((d) => d.id === data.dashboard);
        return (
          <div className="scroll" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px 18px', alignContent: 'start' }}>
            {data.panels.map((p, i) => {
              const def = dashboard?.panels[i];
              if (!def) return null;
              const title = t(`case.${def.titleKey}`);
              return (
                <div key={i} style={{ gridColumn: i === 0 ? '1 / -1' : undefined }}>
                  <div className="result-head"><strong>{title}</strong><button className="link link--quiet" onClick={() => openInMetrics(def.query)}>{t('dashboard.edit')}</button></div>
                  {'error' in p ? <ErrorLine error={p.error} /> : (
                    <MetricsPanel title={title} unit={def.unit} panel={p} height={i === 0 ? 150 : 96} onPin={(from, to) => pin(metricPin(p, from, to, def.unit, title, sourceOf(session, last, 'dashboard')))} />
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}
      {!r && <div className="hint">{t('dashboard.hint')}</div>}
    </>
  );
}

export function LogsTool({ session, run, busy, last, pin, draft, setDraft }: ToolProps) {
  const { t, format } = useI18n();
  const parent = useRef<HTMLDivElement>(null);
  const r = last?.response;
  const records = r?.ok && r.data.tool === 'logs' ? r.data.records : [];
  const virtualizer = useVirtualizer({ count: records.length, getScrollElement: () => parent.current, estimateSize: () => 20, overscan: 20 });
  const doRun = () => void run({ tool: 'logs', filter: draft });
  return (
    <>
      <div className="query-row">
        <input className="query-input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doRun(); }} aria-label={t('logs.filterLabel')} spellCheck={false} />
        <Run cost={session.data.tools.costs.logs} busy={busy} onRun={doRun} label={t('monitor.search')} />
      </div>
      <div className="hint">{t('logs.syntax')}</div>
      {r && !r.ok && <ErrorLine error={r.error} />}
      {r?.ok && r.data.tool === 'logs' && last && (
        <>
          <div className="result-head">
            <span>{t('logs.count', { count: r.data.total, from: clockLabel(r.data.fromMin), to: clockLabel(r.data.toMin) })}</span>
            <span>{t('monitor.ranAt', { clock: clockLabel(r.ranAt), cost: r.costMin })}</span>
          </div>
          <div className="volume" aria-hidden="true">
            {(() => {
              const max = Math.max(1, ...r.data.volume.map((v) => v.count));
              return r.data.volume.map((v) => <i key={v.minute} data-err={v.errors > 0} style={{ height: `${(v.count / max) * 100}%` }} title={`${clockLabel(v.minute)} · ${format(v.count)}`} />);
            })()}
          </div>
          <div className="scroll" ref={parent}>
            {records.length === 0 && <div className="hint">{t('logs.none')}</div>}
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((item) => {
                const rec = records[item.index];
                if (!rec) return null;
                return (
                  <div key={rec.id} className="log-row" style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)` }}>
                    <span className="hint">{clockLabelSeconds(session.data.date, rec.timeMs)}</span>
                    <span className={`sev-${rec.severityText}`}>{rec.severityText}</span>
                    <span className="hint">{rec.service}</span>
                    <span title={rec.body}>{rec.body}</span>
                    <button className="tear" onClick={() => pin(logPin(session.data.date, rec, sourceOf(session, last, 'logs')))}>{t('monitor.tear')}</button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Waterfall({ spans, onPin }: { spans: Span[]; onPin: (s: Span) => void }) {
  const { t } = useI18n();
  const start = Math.min(...spans.map((s) => s.startMs));
  const end = Math.max(...spans.map((s) => s.endMs));
  const total = Math.max(1, end - start);
  const depth = (s: Span): number => {
    const parent = spans.find((p) => p.spanId === s.parentSpanId);
    return parent ? depth(parent) + 1 : 0;
  };
  const ordered = [...spans].sort((a, b) => a.startMs - b.startMs);
  return (
    <div className="scroll">
      {ordered.map((s) => {
        const left = ((s.startMs - start) / total) * 100;
        const width = Math.max(0.4, ((s.endMs - s.startMs) / total) * 100);
        const ms = Math.round(s.endMs - s.startMs);
        return (
          <div key={s.spanId} className="span-row">
            <span className="span-row__name" style={{ paddingLeft: depth(s) * 10 }} title={`${s.service} ${s.name}`}>
              <span className="hint">{s.service}</span> {s.name}{s.attributes['retry.attempt'] ? ` #${s.attributes['retry.attempt']}` : ''}
            </span>
            <span className="span-row__track">
              <span className="span-row__bar" data-kind={s.kind} data-status={s.status.code} style={{ left: `${left}%`, width: `${width}%` }} />
              <span className="span-row__label" style={{ left: `calc(${Math.min(left + width, 88)}% + 4px)` }}>{ms}ms{s.status.message ? ` · ${s.status.message}` : ''}</span>
            </span>
            <button className="tear" onClick={() => onPin(s)}>{t('monitor.tear')}</button>
          </div>
        );
      })}
    </div>
  );
}

export function TracesTool({ session, run, busy, last, list, pin, draft, setDraft, onBack }: ToolProps & { list: RunResult | null; onBack: () => void }) {
  const { t } = useI18n();
  const r = last?.response;
  const showingTrace = r?.ok && r.data.tool === 'trace';
  const listResult = r?.ok && r.data.tool === 'traces' ? last : list;
  const doRun = () => void run({ tool: 'traces', filter: draft });
  const lr = listResult?.response;
  return (
    <>
      <div className="query-row">
        <input className="query-input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doRun(); }} aria-label={t('traces.filterLabel')} spellCheck={false} />
        <Run cost={session.data.tools.costs.traces} busy={busy} onRun={doRun} label={t('monitor.search')} />
      </div>
      <div className="hint">{t('traces.syntax')}</div>
      {r && !r.ok && <ErrorLine error={r.error} />}
      {showingTrace && r.ok && r.data.tool === 'trace' && last ? (
        <>
          <div className="result-head">
            <button className="link" onClick={onBack} disabled={!listResult}>{t('traces.back')}</button>
            <span>trace {r.data.spans[0]?.traceId.slice(0, 16)}… · {t('monitor.ranAt', { clock: clockLabel(r.ranAt), cost: r.costMin })}</span>
          </div>
          <Waterfall spans={r.data.spans} onPin={(s) => pin(spanPin(session.data.date, s, sourceOf(session, last, 'trace')))} />
        </>
      ) : lr?.ok && lr.data.tool === 'traces' ? (
        <>
          <div className="result-head">
            <span>{t('traces.count', { count: lr.data.traces.length, scanned: lr.data.scanned, from: clockLabel(lr.data.fromMin), to: clockLabel(lr.data.toMin) })}</span>
            <span>{t('traces.openCost', { cost: session.data.tools.costs.trace })}</span>
          </div>
          <div className="scroll">
            {lr.data.traces.length === 0 && <div className="hint">{t('traces.none')}</div>}
            {lr.data.traces.map((tr) => (
              <button key={tr.ref} className="trace-row" data-error={tr.error} disabled={busy} onClick={() => void run({ tool: 'trace', ref: tr.ref })}>
                <span className="hint">{clockLabelSeconds(session.data.date, tr.startMs).slice(0, 8)}</span>
                <span>{tr.rootService} {tr.rootName} <span className="hint">· {tr.spanCount} spans · {tr.services.join(', ')}</span></span>
                <span className="trace-row__dur">{(tr.durationMs / 1000).toFixed(2)}s</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

export function ChangesTool({ session, run, busy, last, pin }: ToolProps) {
  const { t } = useI18n();
  const r = last?.response;
  return (
    <>
      <div className="row">
        <Run cost={session.data.tools.costs.changes} busy={busy} onRun={() => void run({ tool: 'changes' })} label={t('changes.pull')} />
        <span className="hint">{t('changes.hint')}</span>
      </div>
      {r?.ok && r.data.tool === 'changes' && last && (
        <div className="scroll">
          {r.data.changes.map((c) => (
            <div key={c.id} className="change">
              <span>{clockLabel(c.at)}</span>
              <span className="hint">{c.kind.toUpperCase()}</span>
              <span className="change__what">{describeChange(c)}<span className="hint"> · {c.author}{'ticket' in c && c.ticket ? ` · ${c.ticket}` : ''}</span></span>
              <button className="link" onClick={() => pin(changePin(c, describeChange(c), sourceOf(session, last, 'changes')))}>{t('monitor.tear')}</button>
              <span className="change__why">“{t(`case.${c.messageKey}`)}”</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function RunbooksTool({ session, run, busy, last, pin }: ToolProps) {
  const { t } = useI18n();
  const r = last?.response;
  const open = r?.ok && r.data.tool === 'runbook' ? session.data.tools.runbooks.find((b) => r.data.tool === 'runbook' && b.id === r.data.runbook) : undefined;
  return (
    <>
      <div className="row">
        {session.data.tools.runbooks.map((b) => (
          <Run key={b.id} cost={session.data.tools.costs.runbook} busy={busy} onRun={() => void run({ tool: 'runbook', runbook: b.id })} label={t(`case.${b.titleKey}`)} />
        ))}
      </div>
      {open && last && (
        <div className="scroll runbook">
          <h3>{t(`case.${open.titleKey}`)}</h3>
          {t(`case.${open.bodyKey}`).split('\n\n').map((para, i) => <p key={i}>{para}</p>)}
          <button className="link" onClick={() => pin(runbookPin(open.id, t(`case.${open.titleKey}`), t(`case.${open.bodyKey}`).split('\n\n').slice(-1)[0]?.slice(0, 90) ?? '', sourceOf(session, last, 'runbook')))}>
            {t('monitor.tear')}
          </button>
        </div>
      )}
    </>
  );
}
