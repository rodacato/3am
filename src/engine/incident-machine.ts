import { assign, setup } from 'xstate';
import type { AppliedMitigation } from './state';
import type { ToolRequest } from './tools';

export type QueryLogEntry = { id: number; request: ToolRequest; ranAt: number; costMin: number; ok: boolean; evidence: string[] };
export type StatusUpdate = { promptId: string; text: string; sentAt: number };
export type StakeholderPrompt = { id: string; at: number };

export type IncidentInput = { caseId: string; seed: number; pageAt: number; budgetMin: number; prompts: StakeholderPrompt[]; statusCostMin: number };

export type IncidentContext = IncidentInput & {
  clock: number;
  ackAt: number | null;
  queries: QueryLogEntry[];
  mitigations: AppliedMitigation[];
  pendingMitigation: AppliedMitigation | null;
  statusUpdates: StatusUpdate[];
  stableAt: number | null;
  closedAt: number | null;
};

export type IncidentEvent =
  | { type: 'START' }
  | { type: 'ACK' }
  | { type: 'QUERY_DONE'; entry: Omit<QueryLogEntry, 'id'> }
  | { type: 'MITIGATE'; mitigationId: string; costMin: number }
  | { type: 'MITIGATION_OBSERVED'; clearsAt: number | null; watchedMin: number }
  | { type: 'SEND_STATUS'; promptId: string; text: string }
  | { type: 'WRITE_POSTMORTEM' }
  | { type: 'SUBMIT_POSTMORTEM' };

export function duePrompt(context: IncidentContext): StakeholderPrompt | null {
  const answered = new Set(context.statusUpdates.map((u) => u.promptId));
  return context.prompts.find((p) => p.at <= context.clock && !answered.has(p.id)) ?? null;
}

export const incidentMachine = setup({
  types: {
    context: {} as IncidentContext,
    events: {} as IncidentEvent,
    input: {} as IncidentInput,
  },
  guards: {
    cleared: ({ event }) => event.type === 'MITIGATION_OBSERVED' && event.clearsAt !== null,
    promptIsDue: ({ context, event }) => event.type === 'SEND_STATUS' && duePrompt(context)?.id === event.promptId,
  },
  actions: {
    recordQuery: assign(({ context, event }) => {
      if (event.type !== 'QUERY_DONE') return {};
      return {
        clock: context.clock + event.entry.costMin,
        queries: [...context.queries, { ...event.entry, id: context.queries.length + 1 }],
      };
    }),
    startMitigation: assign(({ context, event }) => {
      if (event.type !== 'MITIGATE') return {};
      const applied: AppliedMitigation = { id: event.mitigationId, startedAt: context.clock, effectiveAt: context.clock + event.costMin };
      return { pendingMitigation: applied, mitigations: [...context.mitigations, applied], clock: applied.effectiveAt };
    }),
    settle: assign(({ context, event }) => {
      if (event.type !== 'MITIGATION_OBSERVED' || event.clearsAt === null) return {};
      return { clock: Math.max(context.clock, event.clearsAt), stableAt: Math.max(context.clock, event.clearsAt), pendingMitigation: null };
    }),
    keepInvestigating: assign(({ context, event }) => ({
      pendingMitigation: null,
      clock: context.clock + (event.type === 'MITIGATION_OBSERVED' ? event.watchedMin : 0),
    })),
    recordStatus: assign(({ context, event }) => {
      if (event.type !== 'SEND_STATUS') return {};
      const sentAt = context.clock + context.statusCostMin;
      return { clock: sentAt, statusUpdates: [...context.statusUpdates, { promptId: event.promptId, text: event.text, sentAt }] };
    }),
  },
}).createMachine({
  id: 'incident',
  context: ({ input }) => ({
    ...input,
    clock: input.pageAt,
    ackAt: null,
    queries: [],
    mitigations: [],
    pendingMitigation: null,
    statusUpdates: [],
    stableAt: null,
    closedAt: null,
  }),
  initial: 'briefing',
  states: {
    briefing: { on: { START: 'paged' } },
    paged: { on: { ACK: { target: 'investigating', actions: assign(({ context }) => ({ ackAt: context.clock })) } } },
    investigating: {
      on: {
        QUERY_DONE: { actions: 'recordQuery' },
        MITIGATE: { target: 'mitigating', actions: 'startMitigation' },
        SEND_STATUS: { guard: 'promptIsDue', actions: 'recordStatus' },
      },
    },
    mitigating: {
      on: {
        MITIGATION_OBSERVED: [
          { guard: 'cleared', target: 'stable', actions: 'settle' },
          { target: 'investigating', actions: 'keepInvestigating' },
        ],
      },
    },
    stable: {
      on: {
        QUERY_DONE: { actions: 'recordQuery' },
        SEND_STATUS: { guard: 'promptIsDue', actions: 'recordStatus' },
        WRITE_POSTMORTEM: { target: 'postmortem', actions: assign(({ context }) => ({ closedAt: context.clock })) },
      },
    },
    postmortem: { on: { SUBMIT_POSTMORTEM: 'debrief' } },
    debrief: { type: 'final' },
  },
});

export type IncidentPhase = 'briefing' | 'paged' | 'investigating' | 'mitigating' | 'stable' | 'postmortem' | 'debrief';
