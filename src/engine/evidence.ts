import type { CaseData } from './case-schema';
import { logEvidenceKey, spanEvidenceKey, type ToolResponse } from './tools';

// Everything a response put in front of the reader that could be pinned as case evidence.
export function evidenceFromResponse(response: ToolResponse): string[] {
  if (!response.ok) return [];
  const d = response.data;
  const keys = new Set<string>();
  switch (d.tool) {
    case 'metrics': d.panel.evidence.forEach((k) => keys.add(k)); break;
    case 'dashboard': d.panels.forEach((p) => { if ('evidence' in p) p.evidence.forEach((k) => keys.add(k)); }); break;
    case 'logs': d.records.forEach((r) => keys.add(logEvidenceKey(r))); break;
    case 'trace': d.spans.forEach((sp) => keys.add(spanEvidenceKey(sp))); break;
    case 'changes': d.changes.forEach((c) => keys.add(`change:${c.id}`)); break;
    case 'runbook': keys.add(`runbook:${d.runbook}`); break;
    case 'traces':
    case 'map':
      break;
  }
  return [...keys];
}

export function caseEvidenceKeys(data: CaseData): Set<string> {
  return new Set(data.factors.flatMap((f) => f.requiredEvidence.flat()));
}

export type FactorCoverage = { factorId: string; groups: { keys: string[]; satisfiedBy: string | null }[]; covered: boolean };

export function factorCoverage(data: CaseData, evidence: Iterable<string>): FactorCoverage[] {
  const have = new Set(evidence);
  return data.factors.map((f) => {
    const groups = f.requiredEvidence.map((keys) => ({ keys, satisfiedBy: keys.find((k) => have.has(k)) ?? null }));
    return { factorId: f.id, groups, covered: groups.every((g) => g.satisfiedBy !== null) };
  });
}
