import { z } from 'zod';

// Minutes since 00:00 of the case date. Negative values reach into the previous evening.
const minute = z.number().int();
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, 'ids are lowercase, stable and English');
const textKey = z.string().min(1);

const latencySchema = z.object({ medianMs: z.number().positive(), sigma: z.number().min(0) });

export const callSchema = z.object({
  id,
  to: id,
  operation: z.string(),
  timeoutMs: z.number().positive(),
  maxAttempts: z.number().int().min(1),
  configKeys: z.object({ timeoutMs: z.string().optional(), maxAttempts: z.string().optional() }).default({}),
});

export const componentSchema = z.object({
  id,
  kind: z.enum(['service', 'database', 'cache', 'queue', 'external']),
  instrumented: z.boolean().default(true),
  instances: z.number().int().positive().default(1),
  operation: z.string(),
  latency: latencySchema,
  tail: z.object({ ratio: z.number().min(0).max(1), medianMs: z.number().positive(), sigma: z.number().min(0) })
    .default({ ratio: 0, medianMs: 1000, sigma: 0.3 }),
  errorRatio: z.number().min(0).max(1).default(0),
  cpu: z.object({ base: z.number().min(0), perRps: z.number().min(0) }),
  memoryMb: z.number().positive(),
  calls: z.array(callSchema).default([]),
});

export const trafficSchema = z.object({
  entry: id,
  peakRps: z.number().positive(),
  troughRps: z.number().positive(),
  peakHour: z.number().min(0).max(24),
  wobble: z.number().min(0).max(0.5),
});

const configValue = z.union([z.number(), z.string(), z.boolean()]);

export const changeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('config'), id, at: minute, component: id, key: z.string(),
    from: configValue, to: configValue, version: z.string(), author: z.string(), ticket: z.string().optional(), messageKey: textKey,
  }),
  z.object({ kind: z.literal('deploy'), id, at: minute, component: id, version: z.string(), author: z.string(), messageKey: textKey }),
  z.object({ kind: z.literal('flag'), id, at: minute, flag: z.string(), from: z.boolean(), to: z.boolean(), author: z.string(), messageKey: textKey }),
]);

export const effectParam = z.enum(['latency.medianMs', 'tail.ratio', 'tail.medianMs', 'errorRatio', 'cpu', 'memoryMb', 'traffic']);

export const effectSchema = z.object({
  id,
  component: id,
  param: effectParam,
  op: z.enum(['set', 'add', 'mul']),
  value: z.number(),
  from: minute,
  until: minute.optional(),
  rampMin: z.number().min(0).default(0),
  growthPerMin: z.number().default(0),
  resetBy: z.array(id).default([]),
  removedBy: z.array(id).default([]),
});

export const mitigationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('revertChange'), change: id }),
  z.object({ type: z.literal('restart'), component: id }),
  z.object({ type: z.literal('scale'), component: id, instances: z.number().int().positive() }),
]);

export const mitigationSchema = z.object({
  id,
  costMin: z.number().int().positive(),
  actions: z.array(mitigationActionSchema).min(1),
  destroysEvidence: z.array(z.string()).default([]),
});

const severity = z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);

export const logTemplateSchema = z.object({
  id,
  component: id,
  severity,
  body: z.string(),
  trigger: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('rate'), perMin: z.number().min(0), from: minute.optional(), until: minute.optional() }),
    z.object({ kind: z.literal('attemptTimeout'), call: id }),
    z.object({ kind: z.literal('retry'), call: id }),
    z.object({ kind: z.literal('serverError') }),
    z.object({ kind: z.literal('slowRequest'), thresholdMs: z.number().positive() }),
  ]),
  attributes: z.record(z.string(), z.string()).default({}),
});

export const panelSchema = z.object({ titleKey: textKey, query: z.string(), unit: z.enum(['seconds', 'ratio', 'rps', 'percent', 'bytes', 'count']) });

export const toolCostsSchema = z.object({
  metrics: z.number().int().min(0),
  dashboard: z.number().int().min(0),
  logs: z.number().int().min(0),
  traces: z.number().int().min(0),
  trace: z.number().int().min(0),
  changes: z.number().int().min(0),
  runbook: z.number().int().min(0),
  map: z.number().int().min(0),
  statusUpdate: z.number().int().min(0),
});

export const evidenceGroupSchema = z.array(z.string()).min(1);

export const factorSchema = z.object({
  id,
  textKey,
  kind: z.enum(['trigger', 'condition', 'latent']),
  // Every group must be satisfied by at least one of its evidence keys.
  requiredEvidence: z.array(evidenceGroupSchema).default([]),
});

export const solutionStepSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('metrics'), query: z.string() }),
  z.object({ tool: z.literal('logs'), filter: z.string() }),
  z.object({ tool: z.literal('traces'), filter: z.string() }),
  z.object({ tool: z.literal('changes') }),
  z.object({ tool: z.literal('runbook'), runbook: id }),
]);

export const caseSchema = z.object({
  id,
  version: z.number().int().positive(),
  order: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  historyFrom: minute,
  budgetMin: z.number().int().positive(),
  dawn: z.object({ beginsAt: minute, sunriseAt: minute }),
  traffic: trafficSchema,
  components: z.array(componentSchema).min(1),
  config: z.record(z.string(), z.record(z.string(), configValue)).default({}),
  changes: z.array(changeSchema).default([]),
  effects: z.array(effectSchema).default([]),
  logs: z.array(logTemplateSchema).default([]),
  alert: z.object({ id, expr: z.string(), forMin: z.number().int().min(1), summaryKey: textKey }),
  page: z.object({ at: minute }),
  impact: z.object({ slowMs: z.number().positive(), uniqueUserRatio: z.number().min(0).max(1) }),
  tools: z.object({
    costs: toolCostsSchema,
    dashboards: z.array(z.object({ id, titleKey: textKey, panels: z.array(panelSchema).min(1) })).default([]),
    runbooks: z.array(z.object({ id, titleKey: textKey, bodyKey: textKey })).default([]),
  }),
  mitigations: z.array(mitigationSchema).min(1),
  stakeholderPrompts: z.array(z.object({ id, at: minute, fromKey: textKey, askKey: textKey })).default([]),
  factors: z.array(factorSchema).min(1),
  distractorFactors: z.array(z.object({ id, textKey })).default([]),
  causalChain: z.object({
    nodes: z.array(z.object({ id, labelKey: textKey, kind: z.enum(['change', 'condition', 'latent', 'symptom', 'impact']), factor: id.optional() })),
    edges: z.array(z.object({ from: id, to: id })),
  }),
  solution: z.object({ steps: z.array(solutionStepSchema).min(1), mitigation: id }),
  readNext: z.array(id).default([]),
});

export type CaseData = z.infer<typeof caseSchema>;
export type CaseInput = z.input<typeof caseSchema>;
export type Component = z.infer<typeof componentSchema>;
export type Call = z.infer<typeof callSchema>;
export type Change = z.infer<typeof changeSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type Mitigation = z.infer<typeof mitigationSchema>;
export type LogTemplate = z.infer<typeof logTemplateSchema>;
export type Severity = z.infer<typeof severity>;
export type Factor = z.infer<typeof factorSchema>;
export type SolutionStep = z.infer<typeof solutionStepSchema>;
export type Panel = z.infer<typeof panelSchema>;
export type ToolName = keyof z.infer<typeof toolCostsSchema>;

// Cross-references Zod cannot express: every id a case mentions must exist.
export function validateCase(input: CaseInput): CaseData {
  const data = caseSchema.parse(input);
  const problems: string[] = [];
  const components = new Set(data.components.map((c) => c.id));
  const calls = new Set(data.components.flatMap((c) => c.calls.map((call) => call.id)));
  const mitigations = new Set(data.mitigations.map((m) => m.id));
  const changes = new Set(data.changes.map((c) => c.id));
  const nodes = new Set(data.causalChain.nodes.map((n) => n.id));
  const factors = new Set(data.factors.map((f) => f.id));
  const need = (ok: boolean, message: string) => { if (!ok) problems.push(message); };

  need(components.has(data.traffic.entry), `traffic.entry ${data.traffic.entry} is not a component`);
  data.components.forEach((c) => c.calls.forEach((call) => need(components.has(call.to), `call ${call.id} targets unknown ${call.to}`)));
  data.changes.forEach((c) => { if (c.kind !== 'flag') need(components.has(c.component), `change ${c.id} targets unknown ${c.component}`); });
  data.effects.forEach((e) => {
    need(components.has(e.component), `effect ${e.id} targets unknown ${e.component}`);
    [...e.removedBy, ...e.resetBy].forEach((m) => need(mitigations.has(m), `effect ${e.id} names unknown mitigation ${m}`));
  });
  data.logs.forEach((l) => {
    need(components.has(l.component), `log ${l.id} names unknown ${l.component}`);
    if ('call' in l.trigger) need(calls.has(l.trigger.call), `log ${l.id} names unknown call ${l.trigger.call}`);
  });
  data.mitigations.forEach((m) => m.actions.forEach((a) => {
    if (a.type === 'revertChange') need(changes.has(a.change), `mitigation ${m.id} reverts unknown ${a.change}`);
    else need(components.has(a.component), `mitigation ${m.id} targets unknown ${a.component}`);
  }));
  data.causalChain.edges.forEach((e) => need(nodes.has(e.from) && nodes.has(e.to), `causal edge ${e.from}→${e.to} names an unknown node`));
  data.causalChain.nodes.forEach((n) => { if (n.factor) need(factors.has(n.factor), `node ${n.id} names unknown factor ${n.factor}`); });
  need(mitigations.has(data.solution.mitigation), `solution mitigation ${data.solution.mitigation} is unknown`);
  need(data.page.at > data.historyFrom, 'the page must come after the start of history');

  if (problems.length) throw new Error(`Case ${data.id} is invalid:\n- ${problems.join('\n- ')}`);
  return data;
}
