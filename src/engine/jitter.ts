import type { Change, Effect } from './case-schema';
import { createRng } from './random';
import type { Scenario } from './state';

export function jitterOffset(s: Scenario, id: string, maxMin: number): number {
  if (!maxMin) return 0;
  return Math.round((createRng(s.data.id, s.seed, 'jitter', id).next() * 2 - 1) * maxMin);
}

const changeCache = new WeakMap<Scenario['data'], Map<number, Change[]>>();

// The change log as this seed's night saw it; changes that are evidence never move.
export function timedChanges(s: Scenario): Change[] {
  let bySeed = changeCache.get(s.data);
  if (!bySeed) {
    bySeed = new Map();
    changeCache.set(s.data, bySeed);
  }
  let out = bySeed.get(s.seed);
  if (!out) {
    out = s.data.changes.map((c) => ({ ...c, at: c.at + jitterOffset(s, c.id, c.jitterMin) }));
    bySeed.set(s.seed, out);
  }
  return out;
}

export function effectWindow(s: Scenario, effect: Effect): { from: number; until: number | undefined } {
  const shift = jitterOffset(s, effect.id, effect.jitterMin);
  return { from: effect.from + shift, until: effect.until === undefined ? undefined : effect.until + shift };
}

export function effectShift(s: Scenario, effectId: string | undefined): number {
  const effect = effectId ? s.data.effects.find((e) => e.id === effectId) : undefined;
  return effect ? jitterOffset(s, effect.id, effect.jitterMin) : 0;
}
