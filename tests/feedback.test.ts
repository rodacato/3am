import { beforeAll, describe, expect, it } from 'vitest';
import { EMPTY_POSTMORTEM, type Board } from '../src/engine/board';
import type { CaseData } from '../src/engine/case-schema';
import type { IncidentContext, QueryLogEntry } from '../src/engine/incident-machine';
import { reportMethod } from '../src/engine/scoring';
import { runTool } from '../src/engine/tools';
import { metricUnit } from '../src/query/promql/unit';
import { loadAllCases, scenario } from './helpers';

let case01: CaseData;
beforeAll(async () => {
  case01 = (await loadAllCases()).find((c) => c.id === 'case-01') as CaseData;
});

describe('metric units', () => {
  it('reads an error fraction as a ratio, not as requests per second', () => {
    expect(metricUnit('sum(rate(http_server_requests_total{service="checkout-api",status_class="5xx"}[5m])) / sum(rate(http_server_requests_total{service="checkout-api"}[5m]))')).toBe('ratio');
  });

  it('scaling a fraction by 100 makes it a percentage, on either side of the division', () => {
    expect(metricUnit('100 * sum(rate(http_server_requests_total{status_class="5xx"}[5m])) / sum(rate(http_server_requests_total[5m]))')).toBe('percent');
    expect(metricUnit('sum(rate(http_server_requests_total{status_class="5xx"}[5m])) / sum(rate(http_server_requests_total[5m])) * 100')).toBe('percent');
  });

  it('keeps the units the dashboards declare', () => {
    for (const panel of case01.tools.dashboards.flatMap((d) => d.panels)) expect(metricUnit(panel.query)).toBe(panel.unit);
  });

  it('a latency quantile compared against a threshold is still seconds', () => {
    expect(metricUnit(case01.alert.expr)).toBe('seconds');
  });
});

describe('query evidence', () => {
  it('a query that returns no series shows the reader nothing to pin', () => {
    const response = runTool(scenario(case01), case01.page.at, { tool: 'metrics', query: 'histogram_quantile(0.99, sum by (le) (rate(http_client_request_duration_seconds_bucket{service="checkout-api", peer_service="nobody"}[5m])))' });
    if (!response.ok || response.data.tool !== 'metrics') throw new Error('query failed');
    expect(response.data.panel.result.series).toHaveLength(0);
    expect(response.data.panel.evidence).toEqual([]);
  });
});

describe('method report', () => {
  const board: Board = { pins: [], hypotheses: [] };
  let nextId = 1;
  const query = (request: QueryLogEntry['request'], ranAt: number, evidence: string[] = []): QueryLogEntry => ({ id: nextId++, request, ranAt, costMin: 3, ok: true, evidence });
  const context = (queries: QueryLogEntry[], stableAt: number | null): IncidentContext => ({
    caseId: case01.id, seed: 1, pageAt: case01.page.at, budgetMin: case01.budgetMin, prompts: [], statusCostMin: 3,
    clock: Math.max(case01.page.at, ...queries.map((q) => q.ranAt + q.costMin)), ackAt: case01.page.at, queries,
    mitigations: [], pendingMitigation: null, statusUpdates: [], stableAt, closedAt: null,
  });
  const at = () => case01.page.at;

  it('a trace search that leads to an evidential trace is not a detour', () => {
    const queries = [
      query({ tool: 'traces', filter: 'service=checkout-api' }, at()),
      query({ tool: 'trace', ref: 'abc' }, at() + 3, ['span:checkout-api:payment.authorize:timeout']),
    ];
    const report = reportMethod(case01, 1, context(queries, null), board, EMPTY_POSTMORTEM);
    expect(report.queries.every((q) => q.useful)).toBe(true);
    expect(report.detourMin).toBe(0);
  });

  it('a trace search that leads nowhere still counts as off the case evidence', () => {
    const queries = [
      query({ tool: 'traces', filter: 'service=cart-api' }, at()),
      query({ tool: 'trace', ref: 'abc' }, at() + 3, ['span:cart-api:GET /carts/{id}:ok']),
    ];
    expect(reportMethod(case01, 1, context(queries, null), board, EMPTY_POSTMORTEM).detourMin).toBe(6);
  });

  it('checking after the alert is quiet does not count against the time to stable', () => {
    const queries = [query({ tool: 'logs', filter: 'service=payments-db' }, at() + 40)];
    const report = reportMethod(case01, 1, context(queries, at() + 30), board, EMPTY_POSTMORTEM);
    expect(report.queries[0]?.afterStable).toBe(true);
    expect(report.detourMin).toBe(0);
  });
});
