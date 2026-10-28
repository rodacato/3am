import { beforeAll, describe, expect, it } from 'vitest';
import type { CaseData } from '../src/engine/case-schema';
import { runTool } from '../src/engine/tools';
import { logsInMinute } from '../src/telemetry/logs';
import { aggregateMinute, requestsInMinute } from '../src/telemetry/requests';
import { traceByRef } from '../src/telemetry/traces';
import { loadCaseVariant, scenario } from './helpers';

let case01: CaseData;
beforeAll(async () => {
  case01 = await loadCaseVariant('case-01');
});

const P99 = 'histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket{service="checkout-api"}[5m])))';

describe('determinism', () => {
  it('returns identical metrics, logs and traces for the same case, seed and query', () => {
    const run = () => [
      runTool(scenario(case01, 7), 200, { tool: 'metrics', query: P99 }),
      runTool(scenario(case01, 7), 200, { tool: 'logs', filter: 'service:checkout-api level:warn+' }),
      runTool(scenario(case01, 7), 200, { tool: 'traces', filter: 'service:checkout-api min:4s' }),
    ];
    expect(JSON.stringify(run())).toEqual(JSON.stringify(run()));
  });

  it('changes the noise with the seed', () => {
    const a = runTool(scenario(case01, 1), 200, { tool: 'metrics', query: P99 });
    const b = runTool(scenario(case01, 2), 200, { tool: 'metrics', query: P99 });
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });

  it('does not depend on the window a query asked for', () => {
    const wide = runTool(scenario(case01), 200, { tool: 'metrics', query: P99, fromMin: 120 });
    const narrow = runTool(scenario(case01), 200, { tool: 'metrics', query: P99, fromMin: 190 });
    if (!wide.ok || !narrow.ok || wide.data.tool !== 'metrics' || narrow.data.tool !== 'metrics') throw new Error('query failed');
    const w = wide.data.panel.result;
    const n = narrow.data.panel.result;
    const at = (r: typeof w, minute: number) => r.series[0]?.values[r.times.indexOf(minute)];
    expect(at(n, 195)).toEqual(at(w, 195));
  });

  it('never shows data from after the clock', () => {
    const r = runTool(scenario(case01), 200, { tool: 'metrics', query: P99, fromMin: 190, toMin: 260 });
    if (!r.ok || r.data.tool !== 'metrics') throw new Error('query failed');
    expect(Math.max(...r.data.panel.result.times)).toBe(200);
  });
});

describe('signal agreement', () => {
  it('counts the same payment timeouts in metrics and in logs', () => {
    const s = scenario(case01);
    for (const minute of [150, 185, 200]) {
      const a = aggregateMinute(s, minute);
      const metricTimeouts = a.client['checkout.payment']?.outcomes.timeout ?? 0;
      const logTimeouts = logsInMinute(s, minute).filter((r) => r.templateId === 'checkout.payment-timeout').length;
      expect(logTimeouts).toBe(metricTimeouts);
    }
  });

  it('builds the histogram from exactly the requests that traces show', () => {
    const s = scenario(case01);
    const minute = 196;
    const durations = [...requestsInMinute(s, minute, true)].flatMap((r) => r.servers.filter((sv) => sv.component === 'checkout-api').map((sv) => sv.durationMs));
    const a = aggregateMinute(s, minute);
    expect(a.server['checkout-api']?.histogram.count).toBe(durations.length);
    const slowInTraces = durations.filter((d) => d > 4000).length;
    const buckets = a.server['checkout-api']?.histogram.buckets ?? [];
    // Buckets above 4s: 5, 7.5, 10, 15 and +Inf hold every request slower than 4s.
    const slowInHistogram = buckets.slice(-5).reduce((x, y) => x + y, 0);
    expect(slowInHistogram).toBe(slowInTraces);
  });

  it('agrees between trace spans and the client latency histogram', () => {
    const s = scenario(case01);
    const spans = [...requestsInMinute(s, 196, true)].flatMap((r) => r.spans.filter((sp) => sp.name === 'payment.authorize'));
    expect(aggregateMinute(s, 196).client['checkout.payment']?.histogram.count).toBe(spans.length);
  });
});

describe('trace refs', () => {
  it('rebuilds a sampled request and refuses one the minute never had', () => {
    const s = scenario(case01);
    const sampled = [...requestsInMinute(s, 200, false)].length;
    expect(traceByRef(s, `200:${sampled - 1}`)).not.toBeNull();
    expect(traceByRef(s, `${case01.historyFrom}:0`), 'history before midnight has negative minutes').not.toBeNull();
    for (const ref of [`200:${sampled}`, '200:99999', '200:', '200:-1', '200:1.5', `${case01.historyFrom - 1}:0`]) {
      expect(traceByRef(s, ref), ref).toBeNull();
    }
  });
});
