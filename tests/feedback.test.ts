import { beforeAll, describe, expect, it } from 'vitest';
import { EMPTY_POSTMORTEM, type Board, type Postmortem } from '../src/engine/board';
import { blameTerms, casePeople, reviewPostmortem, reviewStatusUpdate } from '../src/engine/rubric';
import type { CaseData } from '../src/engine/case-schema';
import type { IncidentContext, QueryLogEntry } from '../src/engine/incident-machine';
import { reportMethod } from '../src/engine/scoring';
import { runTool } from '../src/engine/tools';
import { metricUnit } from '../src/query/promql/unit';
import { pulseAt } from '../src/telemetry/pulse';
import { affectedUsers } from '../src/telemetry/requests';
import { loadCaseVariant, scenario } from './helpers';

let case01: CaseData;
beforeAll(async () => {
  case01 = await loadCaseVariant('case-01');
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

  it('names each matched factor once, as the rubric counts it', () => {
    const first = case01.factors[0]?.id as string;
    const pm = { ...EMPTY_POSTMORTEM, factors: [first, first, first] };
    expect(reportMethod(case01, 1, context([], null), board, pm).factorsNamed.matched).toEqual([first]);
  });

  it('a restart before looking is called out, unless the restart is the fix', () => {
    const restarted = { ...context([query({ tool: 'changes' }, at() + 6)], null), mitigations: [{ id: 'restart-checkout', startedAt: at(), effectiveAt: at() + 4 }] };
    expect(reportMethod(case01, 1, restarted, board, EMPTY_POSTMORTEM).restartedBeforeLooking).toBe(true);
    const restartIsTheFix = { ...case01, solution: { ...case01.solution, mitigation: 'restart-checkout' } };
    expect(reportMethod(restartIsTheFix, 1, restarted, board, EMPTY_POSTMORTEM).restartedBeforeLooking).toBe(false);
  });
});

describe('postmortem rubric', () => {
  const terms = blameTerms('fault|blame|should have');
  const item = (pm: Postmortem, id: string) => reviewPostmortem(case01, pm, terms).find((r) => r.id === id);

  it('a neutral sentence that names who ran a step is a question for the reader, not a failure', () => {
    const pm = { ...EMPTY_POSTMORTEM, timeline: '03:03 r.ibarra pushed config v413 after reading the provider SLA doc.' };
    expect(item(pm, 'pm.blameless')?.passed).toBe(true);
    expect(item(pm, 'pm.namesPerson')).toMatchObject({ kind: 'self', passed: null, params: { name: 'r.ibarra' } });
  });

  it('blame vocabulary still fails, with or without a name', () => {
    expect(item({ ...EMPTY_POSTMORTEM, summary: 'The on-call team should have caught it.' }, 'pm.blameless')).toMatchObject({ passed: false, params: { term: 'should have' } });
  });

  it('counts each contributing factor once, however often it is listed', () => {
    const first = case01.factors[0]?.id as string;
    const pm = { ...EMPTY_POSTMORTEM, factors: case01.factors.map(() => first) };
    expect(item(pm, 'pm.factorsFound')).toMatchObject({ passed: false, params: { matched: 1 } });
    expect(item(pm, 'pm.morethanOne')?.passed).toBe(false);
  });

  it('asks nothing about names when nobody is named', () => {
    expect(item({ ...EMPTY_POSTMORTEM, summary: 'A config push raised the payment timeout.' }, 'pm.namesPerson')).toBeUndefined();
  });

  it('a status update that names someone gets the same question', () => {
    const checks = reviewStatusUpdate('r.ibarra is rolling back the 03:03 config. 7% of orders slow. Next update 03:50.', terms, casePeople(case01));
    expect(checks.find((c) => c.id === 'status.blameless')?.passed).toBe(true);
    expect(checks.find((c) => c.id === 'status.namesPerson')?.kind).toBe('self');
  });
});

describe('phone pulse', () => {
  it('reports new affected users from the data, consistent with the running total', () => {
    const s = scenario(case01);
    const at = case01.page.at;
    const pulse = pulseAt(s, at);
    expect(pulse.affectedLastMinute).toBeGreaterThan(0);
    expect(Math.abs(pulse.affectedLastMinute - (affectedUsers(s, at) - affectedUsers(s, at - 1)))).toBeLessThanOrEqual(1);
  });

  it('a slow threshold above the largest bucket counts only the overflow as slow, not every request', () => {
    const at = case01.page.at;
    const slowRatios = (slowMs: number) => Object.values(pulseAt(scenario({ ...case01, impact: { ...case01.impact, slowMs } }), at).components).map((c) => c.slowRatio);
    const atCase = slowRatios(case01.impact.slowMs);
    slowRatios(20_000).forEach((ratio, i) => expect(ratio).toBeLessThanOrEqual(atCase[i] as number));
  });

  it('once the rollback lands, the minute count drops even though the total keeps its history', () => {
    const at = case01.page.at;
    const reverted = scenario(case01, 1, [{ id: 'revert-cfg-413', startedAt: at, effectiveAt: at + 5 }]);
    const later = pulseAt(reverted, at + 15);
    expect(later.alertFiring).toBe(false);
    expect(later.affectedLastMinute).toBeLessThan(pulseAt(scenario(case01), at + 15).affectedLastMinute / 5);
    expect(later.affectedUsers).toBeGreaterThan(pulseAt(reverted, at).affectedUsers);
  });
});
