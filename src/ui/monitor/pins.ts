import type { Pin } from '../../engine/board';
import type { Change, ToolName } from '../../engine/case-schema';
import { hashSeed } from '../../engine/random';
import { clockLabel, clockLabelSeconds } from '../../engine/time';
import { logEvidenceKey, spanEvidenceKey, type MetricsResult } from '../../engine/tools';
import type { LogRecord, Span } from '../../telemetry/otel';
import { formatValue, type Unit } from './format';

export type PinInput = Omit<Pin, 'x' | 'y' | 'rot'>;
export type PinSource = { tool: ToolName; queryId: number; ranAt: number; costMin: number };

export function labelText(labels: Readonly<Record<string, string>>): string {
  const entries = Object.entries(labels).filter(([k]) => k !== '__name__');
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(' ') : '';
}

export function logPin(date: string, record: LogRecord, source: PinSource): PinInput {
  return {
    id: `log-${source.queryId}-${record.id}`,
    kind: 'log',
    evidence: [logEvidenceKey(record)],
    lines: [record.body, `${clockLabelSeconds(date, record.timeMs)} ${record.severityText} ${record.service}`],
    sparkline: null,
    highlight: null,
    source,
  };
}

export function metricPin(panel: MetricsResult, fromMin: number, toMin: number, unit: Unit, title: string, source: PinSource): PinInput {
  const { times, series } = panel.result;
  const first = series[0];
  const values = (first?.values ?? []).map((v) => v ?? 0);
  const fromIdx = Math.max(0, times.indexOf(fromMin));
  const toIdx = Math.max(fromIdx, times.indexOf(toMin) === -1 ? times.length - 1 : times.indexOf(toMin));
  const inRange = values.slice(fromIdx, toIdx + 1);
  const peak = inRange.length ? Math.max(...inRange) : 0;
  return {
    id: `metric-${source.queryId}-${hashSeed(panel.query).toString(36)}-${fromMin}-${toMin}`,
    kind: 'metric',
    evidence: panel.evidence,
    lines: [title, `${clockLabel(fromMin)}–${clockLabel(toMin)} · max ${formatValue(peak, unit)}${first && labelText(first.labels) ? ` · ${labelText(first.labels)}` : ''}`],
    sparkline: values,
    highlight: [fromIdx, toIdx],
    source,
  };
}

export function spanPin(date: string, span: Span, source: PinSource): PinInput {
  const ms = Math.round(span.endMs - span.startMs);
  const attempt = span.attributes['retry.attempt'];
  return {
    id: `span-${span.traceId.slice(0, 8)}-${span.spanId}`,
    kind: 'span',
    evidence: [spanEvidenceKey(span)],
    lines: [`${span.service} ${span.name}${attempt ? ` attempt=${attempt}` : ''}`, `${ms}ms · ${span.status.message ?? span.status.code} · ${clockLabelSeconds(date, span.startMs)}`, `trace ${span.traceId.slice(0, 16)}…`],
    sparkline: null,
    highlight: null,
    source,
  };
}

export function changePin(change: Change, describe: string, source: PinSource): PinInput {
  return {
    id: `change-${change.id}`,
    kind: 'change',
    evidence: [`change:${change.id}`],
    lines: [describe, `${clockLabel(change.at)} · ${change.author}${'ticket' in change && change.ticket ? ` · ${change.ticket}` : ''}`],
    sparkline: null,
    highlight: null,
    source,
  };
}

export function runbookPin(id: string, title: string, excerpt: string, source: PinSource): PinInput {
  return { id: `runbook-${id}`, kind: 'runbook', evidence: [`runbook:${id}`], lines: [title, excerpt], sparkline: null, highlight: null, source };
}

export function describeChange(c: Change): string {
  switch (c.kind) {
    case 'config': return `config ${c.component} ${c.version}: ${c.key} ${String(c.from)} → ${String(c.to)}`;
    case 'deploy': return `deploy ${c.component} ${c.version}`;
    case 'flag': return `flag ${c.flag} ${String(c.from)} → ${String(c.to)}`;
  }
}
