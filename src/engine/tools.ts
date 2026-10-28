import { FilterError, parseLogFilter, parseTraceFilter, resolveWindow, severityRank } from '../query/filters';
import type { Expr } from '../query/promql/ast';
import { PromQLError } from '../query/promql/errors';
import { evaluateRange, type QueryResult } from '../query/promql/evaluate';
import { parsePromQL } from '../query/promql/parse';
import { logsInMinute } from '../telemetry/logs';
import type { LogRecord, Span } from '../telemetry/otel';
import { metricSource } from '../telemetry/source';
import { searchTraces, traceByRef, type TraceSummary } from '../telemetry/traces';
import type { Change, ToolName } from './case-schema';
import { timedChanges } from './jitter';
import type { Scenario } from './state';

export const DEFAULT_WINDOW_MIN = 90;
const LOG_LIMIT = 5000;
const TRACE_LIMIT = 150;

export type ToolRequest =
  | { tool: 'metrics'; query: string; fromMin?: number; toMin?: number }
  | { tool: 'dashboard'; dashboard: string }
  | { tool: 'logs'; filter: string }
  | { tool: 'traces'; filter: string }
  | { tool: 'trace'; ref: string }
  | { tool: 'changes' }
  | { tool: 'runbook'; runbook: string }
  | { tool: 'map' };

export type ToolError = { kind: 'promql' | 'filter' | 'missing'; code: string; detail: string };

export type MetricsResult = { query: string; result: QueryResult; evidence: string[] };

export type ToolData =
  | { tool: 'metrics'; panel: MetricsResult }
  | { tool: 'dashboard'; dashboard: string; panels: (MetricsResult | { query: string; error: ToolError })[] }
  | { tool: 'logs'; records: LogRecord[]; total: number; volume: { minute: number; count: number; errors: number }[]; fromMin: number; toMin: number }
  | { tool: 'traces'; traces: TraceSummary[]; scanned: number; fromMin: number; toMin: number }
  | { tool: 'trace'; ref: string; spans: Span[] }
  | { tool: 'changes'; changes: Change[] }
  | { tool: 'runbook'; runbook: string }
  | { tool: 'map' };

export type ToolResponse = { ok: true; costMin: number; ranAt: number; data: ToolData } | { ok: false; costMin: number; ranAt: number; error: ToolError };

export function toolCost(s: Scenario, tool: ToolName): number {
  return s.data.tools.costs[tool];
}

// Which metric families and services a query looks at, so a pinned chart can be matched to case evidence.
export function metricEvidenceKeys(query: string): string[] {
  const keys = new Set<string>();
  const walk = (e: Expr): void => {
    switch (e.type) {
      case 'vector': {
        const name = e.matchers.find((m) => m.name === '__name__')?.value ?? '';
        const service = e.matchers.find((m) => m.name === 'service' && m.op === '=')?.value ?? '*';
        keys.add(`metric:${name.replace(/_(bucket|count|sum)$/, '')}:${service}`);
        return;
      }
      case 'matrix': return walk(e.selector);
      case 'call': return e.args.forEach(walk);
      case 'aggregate': return walk(e.expr);
      case 'binary': walk(e.lhs); return walk(e.rhs);
      case 'negate': return walk(e.expr);
      case 'number': return;
    }
  };
  try {
    walk(parsePromQL(query));
  } catch {
    return [];
  }
  return [...keys];
}

export function spanEvidenceKey(span: Span): string {
  const outcome = span.status.code !== 'ERROR' ? 'ok' : span.status.message?.startsWith('timeout') ? 'timeout' : 'error';
  return `span:${span.service}:${span.name}:${outcome}`;
}

export function logEvidenceKey(record: LogRecord): string {
  return `log:${record.templateId}`;
}

function toToolError(e: unknown): ToolError {
  if (e instanceof PromQLError) return { kind: 'promql', code: e.code, detail: e.detail };
  if (e instanceof FilterError) return { kind: 'filter', code: e.code, detail: e.detail };
  throw e;
}

function runMetrics(s: Scenario, now: number, query: string, fromMin?: number, toMin?: number): MetricsResult {
  const to = Math.min(now, toMin ?? now);
  const from = Math.max(s.data.historyFrom, fromMin ?? to - DEFAULT_WINDOW_MIN);
  const result = evaluateRange(metricSource(s, now), query, { fromMin: from, toMin: to, stepMin: 1 });
  return { query, result, evidence: result.series.length ? metricEvidenceKeys(query) : [] };
}

function costOf(s: Scenario, request: ToolRequest): number {
  return toolCost(s, request.tool);
}

export function runTool(s: Scenario, now: number, request: ToolRequest): ToolResponse {
  const costMin = costOf(s, request);
  const done = (data: ToolData): ToolResponse => ({ ok: true, costMin, ranAt: now, data });
  try {
    switch (request.tool) {
      case 'metrics':
        return done({ tool: 'metrics', panel: runMetrics(s, now, request.query, request.fromMin, request.toMin) });
      case 'dashboard': {
        const dashboard = s.data.tools.dashboards.find((d) => d.id === request.dashboard);
        if (!dashboard) return { ok: false, costMin: 0, ranAt: now, error: { kind: 'missing', code: 'dashboard', detail: request.dashboard } };
        const panels = dashboard.panels.map((p) => {
          try {
            return runMetrics(s, now, p.query);
          } catch (e) {
            return { query: p.query, error: toToolError(e) };
          }
        });
        return done({ tool: 'dashboard', dashboard: dashboard.id, panels });
      }
      case 'logs': {
        const f = parseLogFilter(request.filter);
        const { fromMin, toMin } = resolveWindow(f.window, now, 30, s.data.historyFrom);
        const records: LogRecord[] = [];
        const volume: { minute: number; count: number; errors: number }[] = [];
        let total = 0;
        for (let m = fromMin; m <= toMin; m++) {
          let count = 0;
          let errors = 0;
          for (const r of logsInMinute(s, m)) {
            if (f.services.length && !f.services.includes(r.service)) continue;
            if (f.exactSeverity && r.severityText !== f.exactSeverity) continue;
            if (f.minSeverity && severityRank(r.severityText) < severityRank(f.minSeverity)) continue;
            if (f.traceId && !r.traceId?.startsWith(f.traceId)) continue;
            const body = r.body.toLowerCase();
            if (f.include.some((t) => !body.includes(t)) || f.exclude.some((t) => body.includes(t))) continue;
            count += 1;
            if (severityRank(r.severityText) >= severityRank('ERROR')) errors += 1;
            records.push(r);
          }
          total += count;
          volume.push({ minute: m, count, errors });
        }
        records.sort((a, b) => b.timeMs - a.timeMs);
        return done({ tool: 'logs', records: records.slice(0, LOG_LIMIT), total, volume, fromMin, toMin });
      }
      case 'traces': {
        const f = parseTraceFilter(request.filter);
        const { fromMin, toMin } = resolveWindow(f.window, now, 15, s.data.historyFrom);
        const found = searchTraces(s, {
          ...(f.service ? { service: f.service } : {}),
          ...(f.operation ? { operation: f.operation } : {}),
          ...(f.minDurationMs !== null ? { minDurationMs: f.minDurationMs } : {}),
          errorsOnly: f.errorsOnly,
          fromMin,
          toMin,
          limit: TRACE_LIMIT,
        });
        return done({ tool: 'traces', traces: found.traces, scanned: found.scanned, fromMin, toMin });
      }
      case 'trace': {
        const spans = traceByRef(s, request.ref);
        if (!spans) return { ok: false, costMin: 0, ranAt: now, error: { kind: 'missing', code: 'trace', detail: request.ref } };
        return done({ tool: 'trace', ref: request.ref, spans });
      }
      case 'changes':
        return done({ tool: 'changes', changes: timedChanges(s).filter((c) => c.at <= now).sort((a, b) => b.at - a.at) });
      case 'runbook':
        if (!s.data.tools.runbooks.some((b) => b.id === request.runbook)) return { ok: false, costMin: 0, ranAt: now, error: { kind: 'missing', code: 'runbook', detail: request.runbook } };
        return done({ tool: 'runbook', runbook: request.runbook });
      case 'map':
        return done({ tool: 'map' });
    }
  } catch (e) {
    return { ok: false, costMin: 0, ranAt: now, error: toToolError(e) };
  }
}

export const STABLE_FOR_MIN = 5;
export const WATCH_LIMIT_MIN = 20;

// After a mitigation lands, the reader watches the charts: the minute a quiet stretch is confirmed,
// or null if nothing quiets down, or the condition comes back before the watch is over.
export function observeMitigation(s: Scenario, effectiveAt: number): number | null {
  const watchEnd = effectiveAt + WATCH_LIMIT_MIN;
  for (let m = effectiveAt; m <= watchEnd; m++) {
    let quiet = true;
    for (let k = m; k < m + STABLE_FOR_MIN && quiet; k++) quiet = !isAlertFiring(s, k);
    if (!quiet) continue;
    const clearsAt = m + STABLE_FOR_MIN - 1;
    for (let k = clearsAt + 1; k <= watchEnd; k++) if (isAlertConditionTrue(s, k)) return null;
    return clearsAt;
  }
  return null;
}

function alertSeries(s: Scenario, fromMin: number, toMin: number) {
  return evaluateRange(metricSource(s, toMin), s.data.alert.expr, { fromMin, toMin, stepMin: 1 });
}

// The alert's expression at one minute, without waiting for it to hold.
export function isAlertConditionTrue(s: Scenario, minute: number): boolean {
  return alertSeries(s, minute, minute).series.some((x) => x.values[0] !== null);
}

export function isAlertFiring(s: Scenario, minute: number): boolean {
  const from = minute - s.data.alert.forMin + 1;
  if (from < s.data.historyFrom) return false;
  const result = alertSeries(s, from, minute);
  return result.series.length > 0 && result.times.every((_, i) => result.series.some((x) => x.values[i] !== null));
}
