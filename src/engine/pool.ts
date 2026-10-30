import type { Rng } from './random';

// One minute of a connection pool, per caller instance. See ADR 0015 for the model and its limits.
export type PoolState = {
  size: number;
  instances: number;
  leaked: number;
  demand: number;
  inUse: number;
  utilization: number;
  overflow: number;
  meanWaitMs: number;
  acquireTimeoutMs: number;
  holdMs: number;
  extraHoldMs: number;
};

export type PoolInput = {
  size: number;
  maxConnections: number | undefined;
  instances: number;
  callsPerSecond: number;
  holdMs: number;
  extraHoldMs: number;
  leaked: number;
  acquireTimeoutMs: number;
};

// Sakasegawa's approximation of the M/M/c wait: negligible well below capacity, unbounded as utilization nears 1.
export function queueWaitMs(holdMs: number, servers: number, utilization: number): number {
  if (servers <= 0 || utilization >= 1) return Infinity;
  if (utilization <= 0) return 0;
  return (holdMs * utilization ** (Math.sqrt(2 * (servers + 1)) - 1)) / (servers * (1 - utilization));
}

export function poolState(p: PoolInput): PoolState {
  const size = p.maxConnections === undefined ? p.size : Math.min(p.size, Math.floor(p.maxConnections / p.instances));
  const leaked = Math.min(size, Math.max(0, Math.floor(p.leaked)));
  const free = size - leaked;
  const holdMs = p.holdMs + p.extraHoldMs;
  // Little's law: connections busy at once = arrivals per second × seconds each one is held.
  const demand = (p.callsPerSecond * holdMs) / 1000 / p.instances;
  const utilization = free > 0 ? demand / free : Infinity;
  return {
    size,
    instances: p.instances,
    leaked,
    demand,
    inUse: Math.min(size, leaked + demand),
    utilization,
    overflow: utilization > 1 ? 1 - 1 / utilization : 0,
    meanWaitMs: Math.min(p.acquireTimeoutMs, queueWaitMs(holdMs, free, utilization)),
    acquireTimeoutMs: p.acquireTimeoutMs,
    holdMs,
    extraHoldMs: p.extraHoldMs,
  };
}

export type Acquisition = { waitMs: number; timedOut: boolean };

// Over capacity, the overflow share gives up at the acquire timeout; everyone else waits less than that.
export function acquire(pool: PoolState, rng: Rng): Acquisition {
  if (pool.overflow > 0 && rng.chance(pool.overflow)) return { waitMs: pool.acquireTimeoutMs, timedOut: true };
  if (pool.meanWaitMs < 1) return { waitMs: 0, timedOut: false };
  const cut = 1 - Math.exp(-pool.acquireTimeoutMs / pool.meanWaitMs);
  return { waitMs: -pool.meanWaitMs * Math.log(1 - rng.next() * cut), timedOut: false };
}
