import { useActorRef, useSelector } from '@xstate/react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Board, Postmortem } from '../../engine/board';
import type { CaseData } from '../../engine/case-schema';
import { evidenceFromResponse } from '../../engine/evidence';
import { incidentMachine, type IncidentContext, type IncidentPhase } from '../../engine/incident-machine';
import type { ToolRequest, ToolResponse } from '../../engine/tools';
import type { Pulse } from '../../telemetry/pulse';
import type { SimulationClient } from '../../worker/client';
import type { ScenarioRef } from '../../worker/protocol';
import type { CaseSession } from '../persistence';
import { boardReducer, type BoardAction } from './board-reducer';

export type Session = {
  data: CaseData;
  seed: number;
  phase: IncidentPhase;
  context: IncidentContext;
  board: Board;
  postmortem: Postmortem;
  statusDraft: string;
  pulse: Pulse | null;
  results: ReadonlyMap<number, ToolResponse>;
  send: ReturnType<typeof useActorRef<typeof incidentMachine>>['send'];
  dispatch: (action: BoardAction) => void;
  setPostmortem: (pm: Postmortem) => void;
  setStatusDraft: (text: string) => void;
  runQuery: (request: ToolRequest) => Promise<{ id: number; response: ToolResponse }>;
  reopenQuery: (id: number) => Promise<ToolResponse | null>;
  previewQuery: (request: ToolRequest, at: number) => Promise<ToolResponse>;
  observeMitigation: () => Promise<number | null>;
  scenarioAt: (minute: number) => ScenarioRef;
};

export function useCaseSession(data: CaseData, initial: CaseSession, client: SimulationClient, persist: (s: CaseSession) => void): Session {
  const input = useMemo(() => ({
    caseId: data.id,
    seed: initial.seed,
    pageAt: data.page.at,
    budgetMin: data.budgetMin,
    prompts: data.stakeholderPrompts.map((p) => ({ id: p.id, at: p.at })),
    statusCostMin: data.tools.costs.statusUpdate,
  }), [data, initial.seed]);

  const actor = useActorRef(incidentMachine, initial.machine ? { input, snapshot: initial.machine as never } : { input });
  const phase = useSelector(actor, (s) => s.value as IncidentPhase);
  const context = useSelector(actor, (s) => s.context);
  const [board, dispatch] = useReducer(boardReducer, initial.board);
  const [postmortem, setPostmortem] = useState(initial.postmortem);
  const [statusDraft, setStatusDraft] = useState(initial.statusDraft);
  const [results, setResults] = useState<Map<number, ToolResponse>>(() => new Map());
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const contextRef = useRef(context);
  contextRef.current = context;

  const scenarioAt = useCallback((minute: number): ScenarioRef => ({
    caseId: data.id,
    seed: initial.seed,
    mitigations: contextRef.current.mitigations.filter((m) => m.startedAt <= minute),
  }), [data.id, initial.seed]);

  useEffect(() => {
    persist({ seed: initial.seed, machine: actor.getPersistedSnapshot(), board, postmortem, statusDraft });
  }, [actor, persist, initial.seed, context, phase, board, postmortem, statusDraft]);

  const mitigationKey = context.mitigations.map((m) => m.id + m.startedAt).join();
  useEffect(() => {
    let live = true;
    client.request({ kind: 'pulse', scenario: scenarioAt(context.clock), now: context.clock }).then((p) => { if (live) setPulse(p); });
    return () => { live = false; };
  }, [client, scenarioAt, context.clock, mitigationKey]);

  const runQuery = useCallback(async (request: ToolRequest) => {
    const now = contextRef.current.clock;
    const response = await client.request({ kind: 'tool', scenario: scenarioAt(now), now, request });
    const id = contextRef.current.queries.length + 1;
    if (response.ok) {
      actor.send({ type: 'QUERY_DONE', entry: { request, ranAt: now, costMin: response.costMin, ok: true, evidence: evidenceFromResponse(response) } });
    }
    setResults((prev) => new Map(prev).set(id, response));
    return { id, response };
  }, [actor, client, scenarioAt]);

  const reopenQuery = useCallback(async (id: number) => {
    const entry = contextRef.current.queries.find((q) => q.id === id);
    if (!entry) return null;
    const response = await client.request({ kind: 'tool', scenario: scenarioAt(entry.ranAt), now: entry.ranAt, request: entry.request });
    setResults((prev) => new Map(prev).set(id, response));
    return response;
  }, [client, scenarioAt]);

  // Free look used while watching a mitigation land; it never touches the query log or the clock.
  const previewQuery = useCallback((request: ToolRequest, at: number) =>
    client.request({ kind: 'tool', scenario: scenarioAt(at), now: at, request }), [client, scenarioAt]);

  const observeMitigation = useCallback(async () => {
    const pending = contextRef.current.pendingMitigation;
    if (!pending) return null;
    const { clearsAt } = await client.request({ kind: 'observe', scenario: scenarioAt(pending.effectiveAt), effectiveAt: pending.effectiveAt });
    return clearsAt;
  }, [client, scenarioAt]);

  return {
    data, seed: initial.seed, phase, context, board, postmortem, statusDraft, pulse, results,
    send: actor.send, dispatch, setPostmortem, setStatusDraft, runQuery, reopenQuery, previewQuery, observeMitigation, scenarioAt,
  };
}
