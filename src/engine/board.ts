import type { ToolName } from './case-schema';

export type PinKind = 'log' | 'metric' | 'span' | 'change' | 'runbook';

// A torn-off slip: the printed header says which query produced it and what it cost.
export type Pin = {
  id: string;
  kind: PinKind;
  evidence: string[];
  lines: string[];
  sparkline: number[] | null;
  highlight: [number, number] | null;
  source: { tool: ToolName; queryId: number; ranAt: number; costMin: number };
  x: number;
  y: number;
  rot: number;
};

export type HypothesisStatus = 'open' | 'confirmed' | 'refuted';

export type Hypothesis = {
  id: string;
  text: string;
  accuses: string | null;
  pins: string[];
  status: HypothesisStatus;
  x: number;
  y: number;
};

export type Board = { pins: Pin[]; hypotheses: Hypothesis[] };

export type ActionItemType = 'prevent' | 'detect' | 'mitigate' | 'process';
export type ActionItem = { text: string; type: ActionItemType | null; owner: string };

export type Postmortem = {
  summary: string;
  timeline: string;
  impact: string;
  factors: string[];
  customFactor: string;
  wentWell: string;
  actionItems: ActionItem[];
};

export const EMPTY_POSTMORTEM: Postmortem = {
  summary: '',
  timeline: '',
  impact: '',
  factors: [],
  customFactor: '',
  wentWell: '',
  actionItems: [{ text: '', type: null, owner: '' }, { text: '', type: null, owner: '' }],
};
