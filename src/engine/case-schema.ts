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

// jitterMin lets the seed move a red herring in time, so a replay is a different night, not the same one.
const jitterMin = z.number().int().min(0).default(0);

export const changeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('config'), id, at: minute, component: id, key: z.string(),
    from: configValue, to: configValue, version: z.string(), author: z.string(), ticket: z.string().optional(), messageKey: textKey, jitterMin,
  }),
  z.object({ kind: z.literal('deploy'), id, at: minute, component: id, version: z.string(), author: z.string(), messageKey: textKey, jitterMin }),
  z.object({ kind: z.literal('flag'), id, at: minute, flag: z.string(), from: z.boolean(), to: z.boolean(), author: z.string(), messageKey: textKey, jitterMin }),
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
  jitterMin,
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
    z.object({ kind: z.literal('rate'), perMin: z.number().min(0), from: minute.optional(), until: minute.optional(), followsEffect: id.optional() }),
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

const configSchema = z.record(z.string(), z.record(z.string(), configValue));
const causalChainSchema = z.object({
  nodes: z.array(z.object({ id, labelKey: textKey, kind: z.enum(['change', 'condition', 'latent', 'symptom', 'impact']), factor: id.optional() })),
  edges: z.array(z.object({ from: id, to: id })),
});
const solutionSchema = z.object({ steps: z.array(solutionStepSchema).min(1), mitigation: id });
const distractorSchema = z.object({ id, textKey });

export const DEFAULT_DEBRIEF_NOTE_KEY = 'debrief.chainNote';
export const IMPLICIT_VARIANT_ID = 'main';

// Strict: a variant may change the cause and the fix, never the city the reader walks into.
export const variantSchema = z.object({
  id,
  changes: z.array(changeSchema).optional(),
  effects: z.array(effectSchema).optional(),
  config: configSchema.optional(),
  mitigations: z.array(mitigationSchema).min(1).optional(),
  factors: z.array(factorSchema).min(1).optional(),
  distractorFactors: z.array(distractorSchema).optional(),
  causalChain: causalChainSchema.optional(),
  solution: solutionSchema.optional(),
  logs: z.array(logTemplateSchema).default([]),
  debriefNoteKey: textKey.optional(),
}).strict();

const sharedShape = {
  id,
  version: z.number().int().positive(),
  order: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  historyFrom: minute,
  budgetMin: z.number().int().positive(),
  dawn: z.object({ beginsAt: minute, sunriseAt: minute }),
  traffic: trafficSchema,
  components: z.array(componentSchema).min(1),
  config: configSchema.default({}),
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
  stakeholderPrompts: z.array(z.object({ id, at: minute, fromKey: textKey, askKey: textKey })).default([]),
  distractorFactors: z.array(distractorSchema).default([]),
  readNext: z.array(id).default([]),
};

// One playable night: what every engine function reads.
export const caseSchema = z.object({
  ...sharedShape,
  variantId: id,
  mitigations: z.array(mitigationSchema).min(1),
  factors: z.array(factorSchema).min(1),
  causalChain: causalChainSchema,
  solution: solutionSchema,
  debriefNoteKey: textKey,
});

// What a case file declares: the shared city, plus either the cause inline or one per variant.
export const caseDefinitionSchema = z.object({
  ...sharedShape,
  mitigations: z.array(mitigationSchema).min(1).optional(),
  factors: z.array(factorSchema).min(1).optional(),
  causalChain: causalChainSchema.optional(),
  solution: solutionSchema.optional(),
  variants: z.array(variantSchema).min(1).optional(),
});

export type CaseData = z.infer<typeof caseSchema>;
export type CaseDefinition = z.infer<typeof caseDefinitionSchema>;
export type CaseInput = z.input<typeof caseDefinitionSchema>;
export type Variant = z.infer<typeof variantSchema>;
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

const resolvedCache = new WeakMap<CaseDefinition, CaseData[]>();

function resolveAll(def: CaseDefinition): CaseData[] {
  const { variants, ...shared } = def;
  return (variants ?? [{ id: IMPLICIT_VARIANT_ID, logs: [] }]).map((v) => {
    const { id: variantId, logs, debriefNoteKey, ...replaced } = v;
    const merged = Object.fromEntries(Object.entries({ ...shared, ...replaced }).filter(([, value]) => value !== undefined));
    const parsed = caseSchema.safeParse({ ...merged, logs: [...shared.logs, ...logs], variantId, debriefNoteKey: debriefNoteKey ?? DEFAULT_DEBRIEF_NOTE_KEY });
    if (!parsed.success) throw new Error(`Case ${def.id} variant ${variantId} is invalid:\n${parsed.error.message}`);
    return parsed.data;
  });
}

export function caseVariants(def: CaseDefinition): CaseData[] {
  let all = resolvedCache.get(def);
  if (!all) {
    all = resolveAll(def);
    resolvedCache.set(def, all);
  }
  return all;
}

export function variantIndex(variantCount: number, seed: number): number {
  return (((seed - 1) % variantCount) + variantCount) % variantCount;
}

export function seedsForVariant(variantCount: number, index: number, count: number): number[] {
  return Array.from({ length: count }, (_, k) => index + 1 + k * variantCount);
}

// The seed picks the night's cause; the same definition always hands back the same object per variant.
export function resolveVariant(def: CaseDefinition, seed: number): CaseData {
  const all = caseVariants(def);
  return all[variantIndex(all.length, seed)] as CaseData;
}

export function validateCase(input: CaseInput): CaseDefinition {
  const def = caseDefinitionSchema.parse(input);
  const variants = caseVariants(def);
  const ids = variants.map((v) => v.variantId);
  if (new Set(ids).size !== ids.length) throw new Error(`Case ${def.id} is invalid:\n- variant ids repeat: ${ids.join(', ')}`);
  for (const data of variants) validateVariant(data, variants.length > 1);
  return def;
}

// Cross-references Zod cannot express: every id a case mentions must exist.
function validateVariant(data: CaseData, named: boolean): void {
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
    if (l.trigger.kind === 'rate' && l.trigger.followsEffect) need(data.effects.some((e) => e.id === (l.trigger as { followsEffect?: string }).followsEffect), `log ${l.id} follows unknown effect`);
  });
  data.mitigations.forEach((m) => m.actions.forEach((a) => {
    if (a.type === 'revertChange') need(changes.has(a.change), `mitigation ${m.id} reverts unknown ${a.change}`);
    else need(components.has(a.component), `mitigation ${m.id} targets unknown ${a.component}`);
  }));
  data.causalChain.edges.forEach((e) => need(nodes.has(e.from) && nodes.has(e.to), `causal edge ${e.from}→${e.to} names an unknown node`));
  data.causalChain.nodes.forEach((n) => { if (n.factor) need(factors.has(n.factor), `node ${n.id} names unknown factor ${n.factor}`); });
  need(mitigations.has(data.solution.mitigation), `solution mitigation ${data.solution.mitigation} is unknown`);
  need(data.page.at > data.historyFrom, 'the page must come after the start of history');
  const evidence = new Set(data.factors.flatMap((f) => f.requiredEvidence.flat()));
  data.changes.forEach((c) => need(!(c.jitterMin > 0 && evidence.has(`change:${c.id}`)), `change ${c.id} is evidence and must not jitter`));

  const label = named ? `Case ${data.id} variant ${data.variantId}` : `Case ${data.id}`;
  if (problems.length) throw new Error(`${label} is invalid:\n- ${problems.join('\n- ')}`);
}
