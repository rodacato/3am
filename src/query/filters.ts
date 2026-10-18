import type { Severity } from '../engine/case-schema';
import { parseDurationMinutes } from '../engine/time';

export type FilterErrorCode = 'unknown_key' | 'bad_value' | 'unclosed_quote' | 'negated_key';

export class FilterError extends Error {
  constructor(readonly code: FilterErrorCode, readonly detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'FilterError';
  }
}

type Token = { key: string | null; value: string; negated: boolean };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    while (input[i] === ' ') i++;
    if (i >= input.length) break;
    const start = i;
    let negated = false;
    if (input[i] === '-') { negated = true; i++; }
    let key: string | null = null;
    const keyMatch = /^([a-z]+):/.exec(input.slice(i));
    if (keyMatch?.[1]) { key = keyMatch[1]; i += keyMatch[0].length; }
    let value: string;
    if (input[i] === '"') {
      const end = input.indexOf('"', i + 1);
      if (end === -1) throw new FilterError('unclosed_quote', input.slice(i));
      value = input.slice(i + 1, end);
      i = end + 1;
    } else {
      const end = input.indexOf(' ', i);
      value = input.slice(i, end === -1 ? input.length : end);
      i = end === -1 ? input.length : end;
    }
    if (value === '') throw new FilterError('bad_value', input.slice(start, i));
    if (negated && key) throw new FilterError('negated_key', `-${key}:${value}`);
    tokens.push({ key, value, negated });
  }
  return tokens;
}

export type TimeWindow = { sinceMin?: number; from?: number; to?: number };

function clockToMinute(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) throw new FilterError('bad_value', value);
  const [hours, minutes] = [Number(m[1]), Number(m[2])];
  if (hours > 23 || minutes > 59) throw new FilterError('bad_value', value);
  return hours * 60 + minutes;
}

function readWindow(t: Token, window: TimeWindow): boolean {
  if (t.key === 'since') {
    const d = parseDurationMinutes(t.value);
    if (d === null || d <= 0) throw new FilterError('bad_value', `since:${t.value}`);
    window.sinceMin = d;
    return true;
  }
  if (t.key === 'from') { window.from = clockToMinute(t.value); return true; }
  if (t.key === 'to') { window.to = clockToMinute(t.value); return true; }
  return false;
}

// Turns the window into [fromMin, toMin], defaulting to the last `defaultMin` minutes before now.
export function resolveWindow(w: TimeWindow, now: number, defaultMin: number, historyFrom: number): { fromMin: number; toMin: number } {
  const toMin = Math.min(now, w.to ?? now);
  const fromMin = w.from ?? toMin - Math.round(w.sinceMin ?? defaultMin);
  return { fromMin: Math.max(historyFrom, fromMin), toMin };
}

const SEVERITIES: readonly Severity[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

export type LogFilter = {
  services: string[];
  minSeverity: Severity | null;
  exactSeverity: Severity | null;
  include: string[];
  exclude: string[];
  traceId: string | null;
  window: TimeWindow;
};

export function parseLogFilter(input: string): LogFilter {
  const f: LogFilter = { services: [], minSeverity: null, exactSeverity: null, include: [], exclude: [], traceId: null, window: {} };
  for (const t of tokenize(input)) {
    if (readWindow(t, f.window)) continue;
    if (t.key === 'service') f.services.push(t.value);
    else if (t.key === 'level') {
      const plus = t.value.endsWith('+');
      const sev = t.value.replace('+', '').toUpperCase() as Severity;
      if (!SEVERITIES.includes(sev)) throw new FilterError('bad_value', `level:${t.value}`);
      if (plus) f.minSeverity = sev;
      else f.exactSeverity = sev;
    } else if (t.key === 'trace') f.traceId = t.value.toLowerCase();
    else if (t.key === null) (t.negated ? f.exclude : f.include).push(t.value.toLowerCase());
    else throw new FilterError('unknown_key', `${t.key}:`);
  }
  return f;
}

export function severityRank(s: string): number {
  return SEVERITIES.indexOf(s as Severity);
}

export type TraceFilter = {
  service: string | null;
  operation: string | null;
  minDurationMs: number | null;
  errorsOnly: boolean;
  window: TimeWindow;
};

function parseMs(value: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(value);
  if (!m) throw new FilterError('bad_value', `min:${value}`);
  return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
}

export function parseTraceFilter(input: string): TraceFilter {
  const f: TraceFilter = { service: null, operation: null, minDurationMs: null, errorsOnly: false, window: {} };
  for (const t of tokenize(input)) {
    if (readWindow(t, f.window)) continue;
    if (t.key === 'service') f.service = t.value;
    else if (t.key === 'operation') f.operation = t.value;
    else if (t.key === 'min') f.minDurationMs = parseMs(t.value);
    else if (t.key === 'status') {
      if (t.value !== 'error') throw new FilterError('bad_value', `status:${t.value}`);
      f.errorsOnly = true;
    } else throw new FilterError('unknown_key', t.key ? `${t.key}:` : t.value);
  }
  return f;
}
