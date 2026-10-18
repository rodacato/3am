import { affectedUsers } from '../telemetry/requests';
import type { Board, Postmortem } from './board';
import type { CaseData } from './case-schema';
import { caseEvidenceKeys, factorCoverage, type FactorCoverage } from './evidence';
import type { IncidentContext } from './incident-machine';
import type { Scenario } from './state';

export type QueryVerdict = { id: number; ranAt: number; costMin: number; tool: string; useful: boolean; afterStable: boolean };

export type MethodReport = {
  timeToMitigateMin: number | null;
  totalMin: number;
  withinBudget: boolean;
  usersAffected: number;
  queries: QueryVerdict[];
  detourMin: number;
  coverage: FactorCoverage[];
  pinnedRelevant: number;
  pinnedTotal: number;
  hypotheses: { confirmed: number; refuted: number; open: number };
  factorsNamed: { expected: string[]; matched: string[]; missed: string[]; distractors: string[] };
  mitigationsTried: string[];
  restartedBeforeLooking: boolean;
};

// Method over luck: how the reader got there matters as much as where they ended up.
export function reportMethod(data: CaseData, seed: number, context: IncidentContext, board: Board, postmortem: Postmortem): MethodReport {
  const relevant = caseEvidenceKeys(data);
  const hasEvidence = (q: IncidentContext['queries'][number]) => q.evidence.some((k) => relevant.has(k));
  // A trace search shows no evidence itself; it is how the reader reaches the trace that does.
  const leadsToEvidence = (i: number) => {
    const next = context.queries.slice(i + 1);
    const end = next.findIndex((q) => q.request.tool === 'traces');
    return next.slice(0, end === -1 ? undefined : end).some((q) => q.request.tool === 'trace' && hasEvidence(q));
  };
  const queries = context.queries.map((q, i) => ({
    id: q.id, ranAt: q.ranAt, costMin: q.costMin, tool: q.request.tool,
    useful: hasEvidence(q) || (q.request.tool === 'traces' && leadsToEvidence(i)),
    afterStable: context.stableAt !== null && q.ranAt >= context.stableAt,
  }));
  const pinnedEvidence = board.pins.flatMap((p) => p.evidence);
  const scenario: Scenario = { data, seed, mitigations: context.mitigations };
  const endedAt = context.stableAt ?? context.clock;
  const expected = data.factors.map((f) => f.id);
  const distractorIds = new Set(data.distractorFactors.map((d) => d.id));
  const restart = context.mitigations.find((m) => data.mitigations.find((d) => d.id === m.id)?.actions.some((a) => a.type === 'restart'));
  const firstLook = context.queries[0]?.ranAt ?? Infinity;

  return {
    timeToMitigateMin: context.stableAt === null ? null : context.stableAt - data.page.at,
    totalMin: context.clock - data.page.at,
    withinBudget: context.clock - data.page.at <= data.budgetMin,
    usersAffected: affectedUsers(scenario, endedAt),
    queries,
    detourMin: queries.filter((q) => !q.useful && !q.afterStable).reduce((sum, q) => sum + q.costMin, 0),
    coverage: factorCoverage(data, pinnedEvidence),
    pinnedRelevant: board.pins.filter((p) => p.evidence.some((k) => relevant.has(k))).length,
    pinnedTotal: board.pins.length,
    hypotheses: {
      confirmed: board.hypotheses.filter((h) => h.status === 'confirmed').length,
      refuted: board.hypotheses.filter((h) => h.status === 'refuted').length,
      open: board.hypotheses.filter((h) => h.status === 'open').length,
    },
    factorsNamed: {
      expected,
      matched: expected.filter((f) => postmortem.factors.includes(f)),
      missed: expected.filter((f) => !postmortem.factors.includes(f)),
      distractors: [...new Set(postmortem.factors)].filter((f) => distractorIds.has(f)),
    },
    mitigationsTried: context.mitigations.map((m) => m.id),
    restartedBeforeLooking: restart !== undefined && restart.startedAt <= firstLook,
  };
}
