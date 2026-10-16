// The course talks to whoever hosts it only through this port: standalone today, Dojo's iframe host later.

export type HostCapability = 'progress' | 'evaluate';

export type HostInit = {
  locale: string | null;
  capabilities: HostCapability[];
};

export type UnitSummary = { timeToMitigateMin: number | null; usersAffected: number; factorsMatched: number; factorsExpected: number };

export type EvaluationRequest = { unitId: string; locale: string; kind: 'postmortem' | 'status'; text: string; rubric: string[] };
export type Evaluation = { verdict: string; notes: string[] };

export interface HostBridge {
  readonly mode: 'standalone' | 'embedded';
  init(): Promise<HostInit>;
  unitStarted(unitId: string): void;
  unitCompleted(unitId: string, summary: UnitSummary): void;
  onLocaleChange(listener: (locale: string) => void): () => void;
  evaluate(request: EvaluationRequest): Promise<Evaluation | null>;
}

export function createStandaloneBridge(): HostBridge {
  return {
    mode: 'standalone',
    init: async () => ({ locale: null, capabilities: ['progress'] }),
    unitStarted: () => {},
    unitCompleted: () => {},
    onLocaleChange: () => () => {},
    evaluate: async () => null,
  };
}
