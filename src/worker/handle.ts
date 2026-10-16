import type { CaseData } from '../engine/case-schema';
import { observeMitigation, runTool } from '../engine/tools';
import { pulseAt } from '../telemetry/pulse';
import { metricVocabulary } from '../telemetry/source';
import type { ScenarioRef, WorkerRequest, WorkerResult } from './protocol';

export type CaseLoader = (caseId: string) => Promise<CaseData>;

// The whole worker, minus postMessage: the same function runs in Node tests and in the browser.
export async function handleRequest<R extends WorkerRequest>(body: R, loadCase: CaseLoader): Promise<WorkerResult<R>> {
  const scenario = async (ref: ScenarioRef) => ({ data: await loadCase(ref.caseId), seed: ref.seed, mitigations: ref.mitigations });
  switch (body.kind) {
    case 'tool':
      return runTool(await scenario(body.scenario), body.now, body.request) as WorkerResult<R>;
    case 'pulse':
      return pulseAt(await scenario(body.scenario), body.now) as WorkerResult<R>;
    case 'observe':
      return { clearsAt: observeMitigation(await scenario(body.scenario), body.effectiveAt) } as WorkerResult<R>;
    case 'vocabulary':
      return metricVocabulary({ data: await loadCase(body.caseId), seed: 0, mitigations: [] }) as WorkerResult<R>;
  }
  throw new Error(`unknown request ${(body as { kind: string }).kind}`);
}
