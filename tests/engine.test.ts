import { beforeAll, describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { validateCase, type CaseData } from '../src/engine/case-schema';
import { incidentMachine, type IncidentInput } from '../src/engine/incident-machine';
import { checkSolvable } from '../src/engine/solvability';
import { effectWindow, timedChanges } from '../src/engine/jitter';
import { aggregateMinute } from '../src/telemetry/requests';
import { isAlertFiring, observeMitigation, runTool } from '../src/engine/tools';
import case01Input from '../src/content/cases/case-01/case';
import { loadAllCases, scenario } from './helpers';

let cases: CaseData[];
let case01: CaseData;
beforeAll(async () => {
  cases = await loadAllCases();
  case01 = cases.find((c) => c.id === 'case-01') as CaseData;
});

describe('case validation', () => {
  it('accepts every shipped case', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it('rejects dangling references', () => {
    const broken = structuredClone(case01Input);
    broken.mitigations = [{ id: 'revert-cfg-413', costMin: 5, actions: [{ type: 'revertChange', change: 'cfg-999' }] }];
    expect(() => validateCase(broken)).toThrow(/reverts unknown cfg-999/);
  });
});

describe('solvability', () => {
  it.each([1, 2, 3, 42])('every case closes within budget with seed %i', (seed) => {
    for (const data of cases) {
      const report = checkSolvable(data, seed);
      expect(report.problems).toEqual([]);
    }
  });
});

describe('seeded red herrings', () => {
  it('moves red herrings with the seed and never moves evidence', () => {
    const cron = case01.effects.find((e) => e.id === 'orders-archive-cron');
    if (!cron) throw new Error('case-01 should have the archive cron');
    const starts = new Set([1, 2, 3, 4, 5, 6].map((seed) => effectWindow(scenario(case01, seed), cron).from));
    expect(starts.size).toBeGreaterThan(2);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const change = timedChanges(scenario(case01, seed)).find((c) => c.id === 'cfg-413');
      expect(change?.at).toBe(case01.changes.find((c) => c.id === 'cfg-413')?.at);
      const window = effectWindow(scenario(case01, seed), cron);
      expect(window.until! - window.from).toBe(cron.until! - cron.from);
    }
  });

  it('keeps logs that follow a red herring inside its moved window', async () => {
    const { logsInMinute } = await import('../src/telemetry/logs');
    const cron = case01.effects.find((e) => e.id === 'orders-archive-cron')!;
    const s = scenario(case01, 4);
    const { from, until } = effectWindow(s, cron);
    expect(logsInMinute(s, from).some((r) => r.templateId === 'db.archive-batch' || r.templateId === 'db.slow-query') || logsInMinute(s, from + 1).some((r) => r.templateId === 'db.archive-batch')).toBe(true);
    expect(logsInMinute(s, until!).some((r) => r.templateId.startsWith('db.'))).toBe(false);
  });

  it('refuses a case that jitters a change its factors depend on', () => {
    const broken = structuredClone(case01Input);
    broken.changes = broken.changes?.map((c) => (c.id === 'cfg-413' ? { ...c, jitterMin: 5 } : c));
    expect(() => validateCase(broken)).toThrow(/must not jitter/);
  });
});

describe('mitigations', () => {
  const start = 200;
  const applied = (id: string, cost: number) => [{ id, startedAt: start, effectiveAt: start + cost }];

  it('reverting the config clears the alert', () => {
    expect(observeMitigation(scenario(case01, 1, applied('revert-cfg-413', 5)), start + 5)).not.toBeNull();
  });

  it('restarting or scaling checkout does not, because the config survives both', () => {
    expect(observeMitigation(scenario(case01, 1, applied('restart-checkout', 4)), start + 4)).toBeNull();
    expect(observeMitigation(scenario(case01, 1, applied('scale-checkout', 8)), start + 8)).toBeNull();
  });

  it('a restart drops requests for a minute', () => {
    const before = aggregateMinute(scenario(case01), start + 3).server['checkout-api']?.errors ?? 0;
    const during = aggregateMinute(scenario(case01, 1, applied('restart-checkout', 4)), start + 3).server['checkout-api']?.errors ?? 0;
    expect(during).toBeGreaterThan(before + 20);
  });

  it('only changes telemetry from the moment it lands', () => {
    const q = { tool: 'metrics' as const, query: 'sum(rate(http_client_requests_total{outcome="timeout"}[5m]))', fromMin: 180, toMin: 220 };
    const plain = runTool(scenario(case01), 230, q);
    const reverted = runTool(scenario(case01, 1, applied('revert-cfg-413', 5)), 230, q);
    if (!plain.ok || !reverted.ok || plain.data.tool !== 'metrics' || reverted.data.tool !== 'metrics') throw new Error('query failed');
    const before = (r: typeof plain.data.panel.result) => r.series[0]?.values.slice(0, 20);
    expect(before(reverted.data.panel.result)).toEqual(before(plain.data.panel.result));
  });

  it('the alert is quiet before the incident and firing at the page', () => {
    expect(isAlertFiring(scenario(case01), case01.page.at - 60)).toBe(false);
    expect(isAlertFiring(scenario(case01), case01.page.at)).toBe(true);
  });
});

describe('incident lifecycle', () => {
  const input = (data: CaseData): IncidentInput => ({
    caseId: data.id, seed: 1, pageAt: data.page.at, budgetMin: data.budgetMin,
    prompts: data.stakeholderPrompts.map((p) => ({ id: p.id, at: p.at })), statusCostMin: data.tools.costs.statusUpdate,
  });

  it('walks briefing → paged → investigating → mitigating → stable → postmortem → debrief', () => {
    for (const data of cases) {
      const actor = createActor(incidentMachine, { input: input(data) }).start();
      const go = (event: Parameters<typeof actor.send>[0]) => { actor.send(event); return actor.getSnapshot(); };
      expect(actor.getSnapshot().value).toBe('briefing');
      expect(go({ type: 'START' }).value).toBe('paged');
      expect(go({ type: 'ACK' }).value).toBe('investigating');
      const afterQuery = go({ type: 'QUERY_DONE', entry: { request: { tool: 'changes' }, ranAt: data.page.at, costMin: 2, ok: true, evidence: [] } });
      expect(afterQuery.context.clock).toBe(data.page.at + 2);
      expect(go({ type: 'MITIGATE', mitigationId: data.solution.mitigation, costMin: 5 }).value).toBe('mitigating');
      expect(go({ type: 'MITIGATION_OBSERVED', clearsAt: null, watchedMin: 5 }).value).toBe('investigating');
      expect(actor.getSnapshot().context.clock).toBe(data.page.at + 12);
      go({ type: 'MITIGATE', mitigationId: data.solution.mitigation, costMin: 5 });
      const stable = go({ type: 'MITIGATION_OBSERVED', clearsAt: data.page.at + 30, watchedMin: 0 });
      expect(stable.value).toBe('stable');
      expect(stable.context.stableAt).toBe(data.page.at + 30);
      expect(go({ type: 'WRITE_POSTMORTEM' }).value).toBe('postmortem');
      expect(go({ type: 'SUBMIT_POSTMORTEM' }).value).toBe('debrief');
      expect(actor.getSnapshot().status).toBe('done');
    }
  });

  it('ignores queries before the page is acknowledged and status updates nobody asked for', () => {
    const actor = createActor(incidentMachine, { input: input(case01) }).start();
    actor.send({ type: 'START' });
    actor.send({ type: 'QUERY_DONE', entry: { request: { tool: 'changes' }, ranAt: 0, costMin: 2, ok: true, evidence: [] } });
    expect(actor.getSnapshot().context.queries).toHaveLength(0);
    actor.send({ type: 'ACK' });
    actor.send({ type: 'SEND_STATUS', promptId: 'lucia-0330', text: 'too early' });
    expect(actor.getSnapshot().context.statusUpdates).toHaveLength(0);
  });

  it('accepts a status update once the stakeholder has asked', () => {
    const actor = createActor(incidentMachine, { input: input(case01) }).start();
    actor.send({ type: 'START' });
    actor.send({ type: 'ACK' });
    const prompt = case01.stakeholderPrompts[0];
    if (!prompt) throw new Error('case-01 should ask for a status update');
    actor.send({ type: 'QUERY_DONE', entry: { request: { tool: 'changes' }, ranAt: 0, costMin: prompt.at - case01.page.at, ok: true, evidence: [] } });
    actor.send({ type: 'SEND_STATUS', promptId: prompt.id, text: 'Checkout is slow for about 7% of orders since 03:03. Next update 03:50.' });
    expect(actor.getSnapshot().context.statusUpdates).toHaveLength(1);
  });
});
