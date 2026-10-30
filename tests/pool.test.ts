import { beforeAll, describe, expect, it } from 'vitest';
import { resolveVariant, validateCase, type CaseData, type CaseInput, type Effect } from '../src/engine/case-schema';
import { poolState, queueWaitMs } from '../src/engine/pool';
import { systemStateAt } from '../src/engine/state';
import { runTool } from '../src/engine/tools';
import { logsInMinute } from '../src/telemetry/logs';
import { seriesCatalog } from '../src/telemetry/metrics';
import { aggregateMinute, requestsInMinute } from '../src/telemetry/requests';
import { loadCaseVariant, scenario } from './helpers';

let case01: CaseData;
beforeAll(async () => {
  case01 = await loadCaseVariant('case-01');
});

const MINUTE = 180;
type EffectInput = Partial<Effect> & Pick<Effect, 'id' | 'param' | 'value'>;

// Case 01 with a pool on checkout-api's database call and forty times the traffic, so a few ms of hold matter.
function pooled(id: string, effects: EffectInput[] = []): CaseData {
  const { variantId: _v, debriefNoteKey: _n, ...rest } = structuredClone(case01);
  const input: CaseInput = {
    ...rest,
    id,
    components: rest.components.map((c) => {
      if (c.id === 'payments-db') return { ...c, maxConnections: 16 };
      if (c.id !== 'checkout-api') return c;
      return { ...c, calls: c.calls.map((call) => (call.id === 'checkout.db' ? { ...call, pool: { size: 4, acquireTimeoutMs: 1000 } } : call)) };
    }),
    effects: [
      ...rest.effects,
      { id: 'busy-night', component: 'storefront', param: 'traffic', op: 'set', value: 40, from: rest.historyFrom },
      ...effects.map((e) => ({ component: 'checkout-api', call: 'checkout.db', op: 'add' as const, from: 150, ...e })),
    ],
    logs: [...rest.logs, { id: 'checkout.pool-timeout', component: 'checkout-api', severity: 'ERROR', body: 'could not acquire connection in {elapsedMs} ms', trigger: { kind: 'poolTimeout', call: 'checkout.db' } }],
  };
  return resolveVariant(validateCase(input), 1);
}

const hold = (ms: number): EffectInput[] => [{ id: 'held', param: 'pool.holdMs', value: ms }];
const poolOf = (data: CaseData, minute = MINUTE, mitigations = scenario(data).mitigations) => {
  const pool = systemStateAt({ data, seed: 1, mitigations }, minute).calls.get('checkout.db')?.pool;
  if (!pool) throw new Error('checkout.db should have a pool');
  return pool;
};
const dbCalls = (data: CaseData, minute = MINUTE) => [...requestsInMinute(scenario(data), minute, false)].flatMap((r) => r.calls.filter((c) => c.callId === 'checkout.db'));

describe('the pool model', () => {
  it('waits nothing well below capacity and more and more as utilization nears 1', () => {
    expect(queueWaitMs(10, 40, 0.5)).toBeLessThan(0.01);
    const near = [0.8, 0.9, 0.95, 0.99].map((u) => queueWaitMs(10, 40, u));
    expect(near).toEqual([...near].sort((a, b) => a - b));
    expect(near[3]).toBeGreaterThan(10);
    expect(queueWaitMs(10, 40, 1)).toBe(Infinity);
  });

  it('sends the overflow share to the acquire timeout once demand passes the free connections', () => {
    const over = poolState({ size: 10, maxConnections: undefined, instances: 2, callsPerSecond: 500, holdMs: 50, extraHoldMs: 0, leaked: 0, acquireTimeoutMs: 2000 });
    expect(over.demand).toBeCloseTo(12.5);
    expect(over.overflow).toBeCloseTo(0.2);
    expect(over.meanWaitMs).toBe(2000);
    expect(over.inUse).toBe(10);
  });

  it('splits the database limit between caller instances, so scaling the caller adds no connections', () => {
    const at = (instances: number) => poolState({ size: 40, maxConnections: 160, instances, callsPerSecond: 0, holdMs: 1, extraHoldMs: 0, leaked: 0, acquireTimeoutMs: 1 });
    expect(at(4).size).toBe(40);
    expect(at(8).size).toBe(20);
    expect(at(8).size * 8).toBe(at(4).size * 4);
  });

  it('counts leaked connections as used and takes them from the free ones', () => {
    const leaky = poolState({ size: 10, maxConnections: undefined, instances: 1, callsPerSecond: 100, holdMs: 50, extraHoldMs: 0, leaked: 6.7, acquireTimeoutMs: 1000 });
    expect(leaky.leaked).toBe(6);
    expect(leaky.inUse).toBe(10);
    expect(leaky.utilization).toBeCloseTo(5 / 4);
  });
});

describe('pooled calls in the simulation', () => {
  it('below capacity: every call gets a connection at once', () => {
    const data = pooled('pool-below');
    expect(poolOf(data).utilization).toBeLessThan(0.5);
    const calls = dbCalls(data);
    expect(calls.length).toBeGreaterThan(100);
    expect(calls.every((c) => c.poolWaitMs === 0 && c.outcome !== 'pool_timeout')).toBe(true);
  });

  it('near capacity: calls queue for a connection, none gives up', () => {
    const data = pooled('pool-near', hold(40));
    const pool = poolOf(data);
    expect(pool.utilization).toBeGreaterThan(0.8);
    expect(pool.utilization).toBeLessThan(1);
    const calls = dbCalls(data);
    expect(calls.filter((c) => (c.poolWaitMs ?? 0) > 0).length).toBeGreaterThan(calls.length / 2);
    expect(calls.some((c) => c.outcome === 'pool_timeout')).toBe(false);
  });

  it('over capacity: the overflow share fails with a pool timeout, the rest wait less than the timeout', () => {
    const data = pooled('pool-over', hold(90));
    const pool = poolOf(data);
    expect(pool.overflow).toBeGreaterThan(0.2);
    const calls = dbCalls(data);
    const timedOut = calls.filter((c) => c.outcome === 'pool_timeout');
    expect(timedOut.length / calls.length).toBeCloseTo(pool.overflow, 1);
    expect(timedOut.every((c) => c.poolWaitMs === 1000 && c.durationMs === 1000 && c.poolHoldMs === null)).toBe(true);
    expect(calls.filter((c) => c.outcome !== 'pool_timeout').every((c) => (c.poolWaitMs ?? 0) < 1000)).toBe(true);
  });

  it('a held connection shows in use time, not in the database call', () => {
    const plain = aggregateMinute(scenario(pooled('pool-hold-plain')), MINUTE).pools['checkout.db'];
    const held = aggregateMinute(scenario(pooled('pool-hold-held', hold(30))), MINUTE).pools['checkout.db'];
    const mean = (h: { sum: number; count: number } | undefined) => (h ? h.sum / h.count : 0);
    expect(mean(held?.use) - mean(plain?.use)).toBeCloseTo(0.03, 2);
  });

  it('scaling the caller leaves the connections the database allows unchanged', () => {
    const data = pooled('pool-scale', hold(90));
    const scaled = [{ id: 'scale-checkout', startedAt: 190, effectiveAt: 198 }];
    const before = poolOf(data, 200);
    const after = poolOf(data, 200, scaled);
    expect(after.instances).toBe(8);
    expect(after.size).toBe(before.size / 2);
    expect(after.size * after.instances).toBe(before.size * before.instances);
    expect(after.overflow).toBeCloseTo(before.overflow, 1);
  });

  it('a leak grows in whole connections, a restart resets it, and it grows back', () => {
    const data = pooled('pool-leak', [{ id: 'leak', param: 'pool.leaked', value: 0, growthPerMin: 0.5, resetBy: ['restart-checkout'] }]);
    const restart = [{ id: 'restart-checkout', startedAt: 196, effectiveAt: 200 }];
    const leaked = (m: number) => poolOf(data, m, restart).leaked;
    expect([150, 151, 152, 153, 154].map(leaked)).toEqual([0, 0, 1, 1, 2]);
    expect(leaked(157)).toBe(3);
    expect(leaked(199)).toBe(4);
    expect(leaked(200)).toBe(0);
    expect(leaked(206)).toBe(3);
  });
});

describe('pool signals agree', () => {
  it('counts the same pool timeouts in metrics, logs and traces, and one wait per attempt', () => {
    const data = pooled('pool-agree', hold(90));
    const s = scenario(data);
    for (const minute of [MINUTE, MINUTE + 7]) {
      const a = aggregateMinute(s, minute);
      const client = a.client['checkout.db'];
      const spans = [...requestsInMinute(s, minute, true)].flatMap((r) => r.spans.filter((sp) => sp.name === 'INSERT payments'));
      const timeouts = client?.outcomes.pool_timeout ?? 0;
      expect(timeouts).toBeGreaterThan(10);
      expect(logsInMinute(s, minute).filter((r) => r.templateId === 'checkout.pool-timeout')).toHaveLength(timeouts);
      expect(spans.filter((sp) => sp.status.message === 'could not acquire connection in 1000 ms')).toHaveLength(timeouts);
      expect(a.pools['checkout.db']?.wait.count).toBe(client?.histogram.count);
      expect(a.pools['checkout.db']?.use.count).toBe((client?.histogram.count ?? 0) - timeouts);
    }
  });

  it('exposes the pool as PromQL series and leaves cases without a pool as they were', () => {
    const r = runTool(scenario(pooled('pool-promql', hold(90))), 200, { tool: 'metrics', query: 'sum by (state) (db_client_connections_usage{service="checkout-api"})' });
    if (!r.ok || r.data.tool !== 'metrics') throw new Error('query failed');
    expect(r.data.panel.result.series.map((x) => x.labels.state).sort()).toEqual(['idle', 'used']);
    expect(r.data.panel.evidence).toEqual(['metric:db_client_connections_usage:checkout-api']);
    expect(seriesCatalog(scenario(case01)).some((d) => d.labels.__name__?.startsWith('db_client_'))).toBe(false);
  });
});
