import { isAlertFiring } from '../engine/tools';
import type { Scenario } from '../engine/state';
import { aggregateMinute, affectedUsers, affectedUsersInMinute, LATENCY_BUCKETS_S } from './requests';
import { cpuAt } from './metrics';

export type ComponentPulse = { errorRatio: number; slowRatio: number; load: number };
export type CallPulse = { failRatio: number; rps: number };
export type Pulse = {
  now: number;
  alertFiring: boolean;
  affectedUsers: number;
  affectedLastMinute: number;
  components: Record<string, ComponentPulse>;
  calls: Record<string, CallPulse>;
};

const WINDOW_MIN = 3;

// What the skyline shows at a glance: which buildings struggle and which cables run hot.
export function pulseAt(s: Scenario, now: number): Pulse {
  const minutes = Array.from({ length: WINDOW_MIN }, (_, i) => now - i).filter((m) => m >= s.data.historyFrom);
  const aggregates = minutes.map((m) => aggregateMinute(s, m));
  const components: Record<string, ComponentPulse> = {};
  const calls: Record<string, CallPulse> = {};
  const bound = LATENCY_BUCKETS_S.findIndex((le) => le * 1000 >= s.data.impact.slowMs);
  const slowFrom = bound === -1 ? LATENCY_BUCKETS_S.length : bound + 1;

  for (const c of s.data.components) {
    let count = 0, errors = 0, slow = 0;
    for (const a of aggregates) {
      const e = a.server[c.id];
      if (!e) continue;
      count += e.histogram.count;
      errors += e.errors;
      slow += e.histogram.buckets.slice(slowFrom).reduce((x, y) => x + y, 0);
    }
    if (c.kind === 'external' || !c.instrumented || count === 0) {
      let attempts = 0, failed = 0;
      for (const caller of s.data.components) for (const call of caller.calls) {
        if (call.to !== c.id) continue;
        for (const a of aggregates) {
          const e = a.client[call.id];
          if (!e) continue;
          attempts += e.histogram.count;
          failed += e.outcomes.timeout + e.outcomes.error;
        }
      }
      components[c.id] = { errorRatio: attempts ? failed / attempts : 0, slowRatio: 0, load: c.kind === 'external' ? 0 : cpuAt(s, c.id, now) };
    } else {
      components[c.id] = { errorRatio: errors / count, slowRatio: slow / count, load: cpuAt(s, c.id, now) };
    }
    for (const call of c.calls) {
      let attempts = 0, failed = 0;
      for (const a of aggregates) {
        const e = a.client[call.id];
        if (!e) continue;
        attempts += e.histogram.count * a.scale;
        failed += (e.outcomes.timeout + e.outcomes.error) * a.scale;
      }
      calls[call.id] = { failRatio: attempts ? failed / attempts : 0, rps: attempts / (60 * Math.max(1, aggregates.length)) };
    }
  }
  return { now, alertFiring: isAlertFiring(s, now), affectedUsers: affectedUsers(s, now), affectedLastMinute: affectedUsersInMinute(s, now), components, calls };
}
