import type { CaseData, SolutionStep } from './case-schema';
import { evidenceFromResponse, factorCoverage } from './evidence';
import type { Scenario } from './state';
import { isAlertFiring, observeMitigation, runTool, type ToolRequest } from './tools';

export type SolvabilityReport = {
  caseId: string;
  variantId: string;
  seed: number;
  ok: boolean;
  problems: string[];
  pagedWhileFiring: boolean;
  quietBeforeIncident: boolean;
  investigationEndsAt: number;
  stableAt: number | null;
  evidence: string[];
};

function toRequest(step: SolutionStep): ToolRequest {
  switch (step.tool) {
    case 'metrics': return { tool: 'metrics', query: step.query };
    case 'logs': return { tool: 'logs', filter: step.filter };
    case 'traces': return { tool: 'traces', filter: step.filter };
    case 'changes': return { tool: 'changes' };
    case 'runbook': return { tool: 'runbook', runbook: step.runbook };
  }
}

// A scripted investigator follows the case's own solution: if it cannot close the case in budget, nobody can.
export function checkSolvable(data: CaseData, seed: number): SolvabilityReport {
  const problems: string[] = [];
  let clock = data.page.at;
  const evidence = new Set<string>();
  const base: Scenario = { data, seed, mitigations: [] };

  const pagedWhileFiring = isAlertFiring(base, data.page.at);
  if (!pagedWhileFiring) problems.push(`alert ${data.alert.id} is not firing at the page time`);
  const quietBeforeIncident = !isAlertFiring(base, data.page.at - 60);
  if (!quietBeforeIncident) problems.push('alert is already firing an hour before the page');

  for (const step of data.solution.steps) {
    const response = runTool(base, clock, toRequest(step));
    if (!response.ok) problems.push(`solution step ${step.tool} failed: ${response.error.code} ${response.error.detail}`);
    evidenceFromResponse(response).forEach((k) => evidence.add(k));
    clock += response.costMin;
  }
  for (const c of factorCoverage(data, evidence)) {
    if (!c.covered) problems.push(`factor ${c.factorId} lacks evidence: ${c.groups.filter((g) => !g.satisfiedBy).map((g) => g.keys.join('|')).join('; ')}`);
  }

  const mitigation = data.mitigations.find((m) => m.id === data.solution.mitigation);
  let stableAt: number | null = null;
  if (mitigation) {
    const applied = { id: mitigation.id, startedAt: clock, effectiveAt: clock + mitigation.costMin };
    stableAt = observeMitigation({ ...base, mitigations: [applied] }, applied.effectiveAt);
    if (stableAt === null) problems.push(`mitigation ${mitigation.id} does not clear the alert`);
    else if (stableAt - data.page.at > data.budgetMin) problems.push(`stable at +${stableAt - data.page.at} min, over the ${data.budgetMin} min budget`);
  }
  // Only the fix may close the night: any other action must leave the alert coming back.
  for (const wrong of data.mitigations) {
    if (wrong.id === data.solution.mitigation) continue;
    const applied = { id: wrong.id, startedAt: clock, effectiveAt: clock + wrong.costMin };
    if (observeMitigation({ ...base, mitigations: [applied] }, applied.effectiveAt) !== null) problems.push(`mitigation ${wrong.id} also clears the alert`);
  }

  return { caseId: data.id, variantId: data.variantId, seed, ok: problems.length === 0, problems, pagedWhileFiring, quietBeforeIncident, investigationEndsAt: clock, stableAt, evidence: [...evidence].sort() };
}
