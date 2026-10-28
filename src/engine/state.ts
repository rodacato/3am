import type { CaseData, Component, Effect } from './case-schema';
import { effectWindow, timedChanges } from './jitter';
import { smoothNoise } from './noise';

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

export type CallState = { id: string; from: string; to: string; operation: string; timeoutMs: number; maxAttempts: number };

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
  for (const component of s.data.components) {
    for (const call of component.calls) {
      const read = (key: string | undefined, fallback: number) => {
        const value = key ? config[component.id]?.[key] : undefined;
        return typeof value === 'number' ? value : fallback;
      };
      calls.set(call.id, {
        id: call.id,
        from: component.id,
        to: call.to,
        operation: call.operation,
        timeoutMs: read(call.configKeys.timeoutMs, call.timeoutMs),
        maxAttempts: read(call.configKeys.maxAttempts, call.maxAttempts),
      });
    }
  }
  const traffic = components.get(s.data.traffic.entry)?.trafficFactor ?? 1;
  const state: SystemState = { minute, entryRps: entryRps(s, minute) * traffic, components, calls };
  byMinute.set(minute, state);
  return state;
}
