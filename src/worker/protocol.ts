import type { AppliedMitigation } from '../engine/state';
import type { ToolRequest, ToolResponse } from '../engine/tools';
import type { Pulse } from '../telemetry/pulse';
import type { MetricVocabulary } from '../telemetry/source';
import type { exportIncident } from '../telemetry/otlp';

export const WORKER_PROTOCOL_VERSION = 1;

export type ScenarioRef = { caseId: string; seed: number; mitigations: AppliedMitigation[] };

export type WorkerRequest =
  | { kind: 'tool'; scenario: ScenarioRef; now: number; request: ToolRequest }
  | { kind: 'pulse'; scenario: ScenarioRef; now: number }
  | { kind: 'observe'; scenario: ScenarioRef; effectiveAt: number }
  | { kind: 'vocabulary'; caseId: string }
  | { kind: 'export'; scenario: ScenarioRef; fromMin: number; toMin: number };

export type WorkerResult<R extends WorkerRequest> =
  R extends { kind: 'tool' } ? ToolResponse
  : R extends { kind: 'pulse' } ? Pulse
  : R extends { kind: 'observe' } ? { clearsAt: number | null }
  : R extends { kind: 'vocabulary' } ? MetricVocabulary
  : R extends { kind: 'export' } ? ReturnType<typeof exportIncident>
  : never;

export type WorkerEnvelope = { v: typeof WORKER_PROTOCOL_VERSION; id: number; body: WorkerRequest };
export type WorkerReply = { v: typeof WORKER_PROTOCOL_VERSION; id: number } & ({ ok: true; result: unknown } | { ok: false; message: string });
