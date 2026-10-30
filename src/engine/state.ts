import type { CaseData, Component, Effect } from './case-schema';
import { effectWindow, timedChanges } from './jitter';
import { smoothNoise } from './noise';
import { poolState, type PoolState } from './pool';

export type AppliedMitigation = { id: string; startedAt: number; effectiveAt: number };

// Everything that determines telemetry: same scenario, same signals.
export type Scenario = { data: CaseData; seed: number; mitigations: readonly AppliedMitigation[] };

export type ComponentState = {
  id: string;
  latency: { medianMs: number; sigma: number };
  tail: { ratio: number; medianMs: number; sigma: number };
  errorRatio: number;
  cpuExtra: number;
  memoryMb: number;
  instances: number;
  trafficFactor: number;
};

export type CallState = {
  id: string;
  from: string;
  to: string;
  operation: string;
  timeoutMs: number;
  maxAttempts: number;
  perRequest: number;
  pool: PoolState | null;
};

export type SystemState = {
  minute: number;
  entryRps: number;
  components: ReadonlyMap<string, ComponentState>;
  calls: ReadonlyMap<string, CallState>;
};

export type ConfigValue = number | string | boolean;

const RESTART_DISRUPTION_MIN = 1;

export function nightKey(s: Scenario): string {
  return `${s.data.id}@${s.data.version}/${s.data.variantId}#${s.seed}`;
}

export function scenarioKey(s: Scenario): string {
  return `${nightKey(s)}|${s.mitigations.map((m) => `${m.id}:${m.startedAt}`).join(',')}`;
}

function effectiveBy(s: Scenario, ids: readonly string[], minute: number): AppliedMitigation | undefined {
  return s.mitigations.find((m) => ids.includes(m.id) && m.effectiveAt <= minute);
}

function mitigationActions(s: Scenario, minute: number) {
  return s.mitigations
    .filter((m) => m.effectiveAt <= minute)
    .flatMap((m) => (s.data.mitigations.find((d) => d.id === m.id)?.actions ?? []).map((action) => ({ action, applied: m })));
}

export function configAt(s: Scenario, minute: number): Record<string, Record<string, ConfigValue>> {
  const config: Record<string, Record<string, ConfigValue>> = {};
  for (const [component, values] of Object.entries(s.data.config)) config[component] = { ...values };
  const reverted = new Set(
    mitigationActions(s, minute).flatMap(({ action }) => (action.type === 'revertChange' ? [action.change] : [])),
  );
  for (const change of timedChanges(s)) {
    if (change.kind !== 'config' || change.at > minute || reverted.has(change.id)) continue;
    (config[change.component] ??= {})[change.key] = change.to;
  }
  return config;
}

export function isChangeReverted(s: Scenario, changeId: string, minute: number): boolean {
  return mitigationActions(s, minute).some(({ action }) => action.type === 'revertChange' && action.change === changeId);
}

export function entryRps(s: Scenario, minute: number): number {
  const { troughRps, peakRps, peakHour, wobble } = s.data.traffic;
  const hour = minute / 60;
  const daily = 0.5 + 0.5 * Math.cos((2 * Math.PI * (hour - peakHour)) / 24);
  const noise = smoothNoise(s.data.id, s.seed, 'traffic')(minute / 45);
  return (troughRps + (peakRps - troughRps) * daily) * (1 + wobble * noise);
}

function effectStrength(effect: Effect, s: Scenario, minute: number): { ramp: number; value: number } | null {
  const { from, until } = effectWindow(s, effect);
  if (minute < from || (until !== undefined && minute >= until)) return null;
  if (effectiveBy(s, effect.removedBy, minute)) return null;
  const reset = s.mitigations
    .filter((m) => effect.resetBy.includes(m.id) && m.effectiveAt <= minute)
    .reduce((latest, m) => Math.max(latest, m.effectiveAt), from);
  const ramp = effect.rampMin > 0 ? Math.min(1, (minute - from + 1) / effect.rampMin) : 1;
  return { ramp, value: effect.value + effect.growthPerMin * (minute - reset) };
}

export function isEffectActive(s: Scenario, effectId: string, minute: number): boolean {
  const effect = s.data.effects.find((e) => e.id === effectId);
  const strength = effect ? effectStrength(effect, s, minute) : null;
  if (!effect || !strength) return false;
  const magnitude = effect.op === 'mul' ? strength.value - 1 : strength.value;
  return strength.ramp * magnitude !== 0;
}

function applyEffect(base: number, effect: Effect, strength: { ramp: number; value: number }): number {
  const { ramp, value } = strength;
  if (effect.op === 'set') return base + (value - base) * ramp;
  if (effect.op === 'add') return base + value * ramp;
  return base * (1 + (value - 1) * ramp);
}

function componentStateAt(s: Scenario, component: Component, minute: number): ComponentState {
  const state: ComponentState = {
    id: component.id,
    latency: { ...component.latency },
    tail: { ...component.tail },
    errorRatio: component.errorRatio,
    cpuExtra: 0,
    memoryMb: component.memoryMb,
    instances: component.instances,
    trafficFactor: 1,
  };
  for (const effect of s.data.effects) {
    if (effect.component !== component.id) continue;
    const strength = effectStrength(effect, s, minute);
    if (!strength) continue;
    switch (effect.param) {
      case 'latency.medianMs': state.latency.medianMs = applyEffect(state.latency.medianMs, effect, strength); break;
      case 'tail.ratio': state.tail.ratio = Math.min(1, applyEffect(state.tail.ratio, effect, strength)); break;
      case 'tail.medianMs': state.tail.medianMs = applyEffect(state.tail.medianMs, effect, strength); break;
      case 'errorRatio': state.errorRatio = Math.min(1, applyEffect(state.errorRatio, effect, strength)); break;
      case 'cpu': state.cpuExtra = applyEffect(state.cpuExtra, effect, strength); break;
      case 'memoryMb': state.memoryMb = applyEffect(state.memoryMb, effect, strength); break;
      case 'traffic': state.trafficFactor = applyEffect(state.trafficFactor, effect, strength); break;
    }
  }
  for (const { action, applied } of mitigationActions(s, minute + RESTART_DISRUPTION_MIN)) {
    if (action.type === 'scale' && action.component === component.id && applied.effectiveAt <= minute) state.instances = action.instances;
    // A restart drops in-flight requests for a minute before the fresh processes take traffic.
    if (action.type === 'restart' && action.component === component.id && minute === applied.effectiveAt - RESTART_DISRUPTION_MIN) {
      state.errorRatio = Math.max(state.errorRatio, 0.3);
    }
  }
  return state;
}

const stateCache = new Map<string, Map<number, SystemState>>();

export function systemStateAt(s: Scenario, minute: number): SystemState {
  const key = scenarioKey(s);
  let byMinute = stateCache.get(key);
  if (!byMinute) {
    if (stateCache.size > 16) stateCache.clear();
    byMinute = new Map();
    stateCache.set(key, byMinute);
  }
  const cached = byMinute.get(minute);
  if (cached) return cached;

  const config = configAt(s, minute);
  const components = new Map(s.data.components.map((c) => [c.id, componentStateAt(s, c, minute)]));
  const calls = new Map<string, CallState>();
  const pools: PendingPool[] = [];
  for (const component of s.data.components) {
    for (const call of component.calls) {
      const read = (key: string | undefined, fallback: number) => {
        const value = key ? config[component.id]?.[key] : undefined;
        return typeof value === 'number' ? value : fallback;
      };
      const tuned = callTuningAt(s, component.id, call.id, minute);
      calls.set(call.id, {
        id: call.id,
        from: component.id,
        to: call.to,
        operation: call.operation,
        timeoutMs: read(call.configKeys.timeoutMs, call.timeoutMs),
        maxAttempts: read(call.configKeys.maxAttempts, call.maxAttempts),
        perRequest: tuned.perRequest,
        pool: null,
      });
      if (call.pool) pools.push({ callId: call.id, size: read(call.configKeys.poolSize, call.pool.size), acquireTimeoutMs: call.pool.acquireTimeoutMs, tuned });
    }
  }
  const traffic = components.get(s.data.traffic.entry)?.trafficFactor ?? 1;
  const state: SystemState = { minute, entryRps: entryRps(s, minute) * traffic, components, calls };
  attachPools(s.data, state, calls, pools);
  byMinute.set(minute, state);
  return state;
}

type CallTuning = { perRequest: number; extraHoldMs: number; leaked: number };
type PendingPool = { callId: string; size: number; acquireTimeoutMs: number; tuned: CallTuning };

function callTuningAt(s: Scenario, componentId: string, callId: string, minute: number): CallTuning {
  const tuned: CallTuning = { perRequest: 1, extraHoldMs: 0, leaked: 0 };
  for (const effect of s.data.effects) {
    if (effect.component !== componentId || effect.call !== callId) continue;
    const strength = effectStrength(effect, s, minute);
    if (!strength) continue;
    switch (effect.param) {
      case 'calls.perRequest': tuned.perRequest = Math.max(0, applyEffect(tuned.perRequest, effect, strength)); break;
      case 'pool.holdMs': tuned.extraHoldMs = Math.max(0, applyEffect(tuned.extraHoldMs, effect, strength)); break;
      case 'pool.leaked': tuned.leaked = Math.max(0, applyEffect(tuned.leaked, effect, strength)); break;
    }
  }
  return tuned;
}

const lognormalMeanMs = (median: number, sigma: number) => median * Math.exp((sigma * sigma) / 2);

// Expected time inside a component, its own calls included, ignoring retries and pool waits.
function expectedVisitMs(data: CaseData, state: SystemState, componentId: string, memo: Map<string, number>): number {
  const known = memo.get(componentId);
  if (known !== undefined) return known;
  const live = state.components.get(componentId);
  const component = data.components.find((c) => c.id === componentId);
  if (!live || !component) return 0;
  let ms = (1 - live.tail.ratio) * lognormalMeanMs(live.latency.medianMs, live.latency.sigma) + live.tail.ratio * lognormalMeanMs(live.tail.medianMs, live.tail.sigma);
  for (const call of component.calls) ms += (state.calls.get(call.id)?.perRequest ?? 1) * expectedVisitMs(data, state, call.to, memo);
  memo.set(componentId, ms);
  return ms;
}

// How often each component is visited per request that enters the system.
function visitsPerEntry(data: CaseData, state: SystemState): Map<string, number> {
  const visits = new Map<string, number>();
  const walk = (componentId: string, times: number) => {
    visits.set(componentId, (visits.get(componentId) ?? 0) + times);
    const component = data.components.find((c) => c.id === componentId);
    for (const call of component?.calls ?? []) walk(call.to, times * (state.calls.get(call.id)?.perRequest ?? 1));
  };
  walk(data.traffic.entry, 1);
  return visits;
}

function attachPools(data: CaseData, state: SystemState, calls: Map<string, CallState>, pools: readonly PendingPool[]): void {
  if (!pools.length) return;
  const visits = visitsPerEntry(data, state);
  const memo = new Map<string, number>();
  for (const pending of pools) {
    const call = calls.get(pending.callId) as CallState;
    const pool = poolState({
      size: pending.size,
      maxConnections: data.components.find((c) => c.id === call.to)?.maxConnections,
      instances: state.components.get(call.from)?.instances ?? 1,
      callsPerSecond: state.entryRps * (visits.get(call.from) ?? 0) * call.perRequest,
      holdMs: expectedVisitMs(data, state, call.to, memo),
      extraHoldMs: pending.tuned.extraHoldMs,
      leaked: pending.tuned.leaked,
      acquireTimeoutMs: pending.acquireTimeoutMs,
    });
    calls.set(call.id, { ...call, pool });
  }
}
