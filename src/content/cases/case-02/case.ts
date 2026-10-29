import type { CaseInput, VariantInput } from '../../../engine/case-schema';

const at = (hh: number, mm: number) => hh * 60 + mm;
const evening = (hh: number, mm: number) => at(hh - 24, mm);

type ChangeInput = NonNullable<VariantInput['changes']>[number];
type EffectInput = NonNullable<VariantInput['effects']>[number];
type LogInput = NonNullable<VariantInput['logs']>[number];
type FactorInput = NonNullable<VariantInput['factors']>[number];
type MitigationInput = NonNullable<VariantInput['mitigations']>[number];

const EXPORT_FROM = at(2, 40);
const EXPORT_UNTIL = at(6, 0);

// The nightly export runs every night; only one night has a database setting it can hurt.
const background: EffectInput[] = [
  { id: 'nightly-export', component: 'export-job', param: 'cpu', op: 'add', value: 0.55, from: EXPORT_FROM, until: EXPORT_UNTIL, rampMin: 2 },
  { id: 'nightly-export-db-cpu', component: 'orders-db', param: 'cpu', op: 'add', value: 0.22, from: EXPORT_FROM, until: EXPORT_UNTIL, rampMin: 2 },
  { id: 'nightly-export-db-latency', component: 'orders-db', param: 'latency.medianMs', op: 'add', value: 3, from: EXPORT_FROM, until: EXPORT_UNTIL, rampMin: 2 },
  { id: 'menu-cache-refresh', component: 'inventory-cache', param: 'cpu', op: 'add', value: 0.2, from: at(1, 30), until: at(1, 44), rampMin: 2, jitterMin: 20 },
  { id: 'gateway-crawler', component: 'web-gateway', param: 'cpu', op: 'add', value: 0.15, from: at(2, 5), until: at(2, 25), rampMin: 3, jitterMin: 15 },
];

// With lock_timeout at 5 s, an order that meets an export batch waits it out; the night it is 200 ms, it fails instead.
const lockWaits: EffectInput = { id: 'nightly-export-lock-waits', component: 'orders-db', param: 'tail.ratio', op: 'set', value: 0.04, from: EXPORT_FROM, until: EXPORT_UNTIL, rampMin: 2 };

// A change costs the service it lands on a minute of CPU; sharing the change's id and jitter keeps that minute, and the log that follows it, where the change is.
function landing(change: ChangeInput, component: string): EffectInput {
  return { id: change.id, component, param: 'cpu', op: 'add', value: 0.03, from: change.at, until: change.at + 1, jitterMin: change.jitterMin ?? 0 };
}

type LandingLogId = 'orders.deploy-rollout' | 'inventory.deploy-rollout' | 'orders.flag-reload' | 'db.config-reload';

function landingLog(id: LandingLogId, component: string, change: ChangeInput, body: string): LogInput {
  return { id, component, severity: 'INFO', body, trigger: { kind: 'rate', perMin: 3, from: change.at, until: change.at + 1, followsEffect: change.id } };
}

function ordersDeploy(id: string, minute: number, version: string, messageKey: string) {
  const change: ChangeInput = { kind: 'deploy', id, at: minute, component: 'orders-api', version, author: 'l.fuentes', messageKey, jitterMin: 2 };
  const log = landingLog('orders.deploy-rollout', 'orders-api', change, `rollout ${version}: 6/6 instances updated in one step, checks: unit tests + 5-minute smoke test`);
  return { change, effect: landing(change, 'orders-api'), log };
}

function inventoryDeploy(id: string, minute: number, version: string, messageKey: string, jitterMin: number, rollout = `rollout ${version}: 3/3 instances updated in one step, checks: unit tests + smoke test of inventory-api (no consumer contract tests)`) {
  const change: ChangeInput = { kind: 'deploy', id, at: minute, component: 'inventory-api', version, author: 'v.cano', messageKey, jitterMin };
  return { change, effect: landing(change, 'inventory-api'), log: landingLog('inventory.deploy-rollout', 'inventory-api', change, rollout) };
}

function flag(id: string, minute: number, name: string, owner: string, author: string, messageKey: string, jitterMin: number) {
  const change: ChangeInput = { kind: 'flag', id, at: minute, flag: name, from: false, to: true, author, messageKey, jitterMin };
  const log = landingLog('orders.flag-reload', 'orders-api', change, `feature flag ${name}: false → true (owner: ${owner}), picked up by 6/6 instances, no change ticket linked`);
  return { change, effect: landing(change, 'orders-api'), log };
}

function dbConfig(id: string, minute: number, key: string, from: string | number, to: string | number, version: string, ticket: string, messageKey: string, jitterMin: number) {
  const change: ChangeInput = { kind: 'config', id, at: minute, component: 'orders-db', key, from, to, version, author: 'd.lozano', ticket, messageKey, jitterMin };
  const log = landingLog('db.config-reload', 'orders-db', change, `parameter reload ${version}: ${key} = ${to} (was ${from}), applied to primary orders-db-0 at once, tested on staging (no nightly jobs there)`);
  return { change, effect: landing(change, 'orders-db'), log };
}

type Landed = { change: ChangeInput; effect: EffectInput; log: LogInput };

// Every night has the same four kinds of change and the same five actions, so the panels never say which night it is.
function night(inventory: Landed, orders: Landed, flagChange: Landed, config: Landed, inventoryMitigation: MitigationInput) {
  const landed = [inventory, orders, flagChange, config];
  return {
    landsAt: { inventory: inventory.change.at, flag: flagChange.change.at },
    changes: landed.map((l) => l.change),
    landings: landed.map((l) => l.effect),
    landingLogs: landed.map((l) => l.log),
    mitigations: [
      inventoryMitigation,
      revert(orders.change.id, `rollback-${orders.change.id.replace('deploy-', '')}`, 6),
      revert(flagChange.change.id, `revert-${flagChange.change.id}`, 2),
      revert(config.change.id, `revert-${config.change.id}`, 4),
      restart,
    ],
  };
}

const restart: MitigationInput = { id: 'restart-orders', costMin: 4, actions: [{ type: 'restart', component: 'orders-api' }] };
const revert = (change: string, id: string, costMin: number): MitigationInput => ({ id, costMin, actions: [{ type: 'revertChange', change }] });

const errorRatio = 'sum by (service) (rate(http_server_requests_total{service="orders-api", status_class="5xx"}[5m])) / sum by (service) (rate(http_server_requests_total{service="orders-api"}[5m]))';
const callOutcomes = 'sum by (peer_service, outcome) (rate(http_client_requests_total{service="orders-api"}[5m]))';

// The causes of tonight's variant, and of every other one: each night's real factors are the other nights' distractors.
const factors = {
  a: [
    { id: 'inventory-shape', kind: 'trigger', textKey: 'variant.a.factor.shape', requiredEvidence: [['change:deploy-inventory-430'], ['log:orders.inventory-decode']] },
    { id: 'strict-decode', kind: 'condition', textKey: 'variant.a.factor.strictDecode', requiredEvidence: [['metric:http_client_requests_total:orders-api', 'span:orders-api:GET /availability:ok']] },
    { id: 'no-contract-test', kind: 'latent', textKey: 'variant.a.factor.noContractTest', requiredEvidence: [['log:inventory.deploy-rollout']] },
  ],
  b: [
    { id: 'dual-write-flag', kind: 'trigger', textKey: 'variant.b.factor.dualWrite', requiredEvidence: [['change:flag-dual-write-v2'], ['log:orders.write-failed']] },
    { id: 'v2-constraint', kind: 'condition', textKey: 'variant.b.factor.constraint', requiredEvidence: [['log:db.error', 'span:orders-api:INSERT orders:error']] },
    { id: 'unannounced-flag', kind: 'latent', textKey: 'variant.b.factor.unannounced', requiredEvidence: [['log:orders.flag-reload']] },
  ],
  c: [
    { id: 'lock-timeout', kind: 'trigger', textKey: 'variant.c.factor.lockTimeout', requiredEvidence: [['change:cfg-pg-v33'], ['log:db.error', 'log:orders.write-failed']] },
    { id: 'export-locks', kind: 'condition', textKey: 'variant.c.factor.exportLocks', requiredEvidence: [['log:export.batch', 'runbook:orders-db']] },
    { id: 'staging-without-jobs', kind: 'latent', textKey: 'variant.c.factor.staging', requiredEvidence: [['log:db.config-reload']] },
  ],
  d: [
    { id: 'inventory-rollback', kind: 'trigger', textKey: 'variant.d.factor.rollback', requiredEvidence: [['change:deploy-inventory-413'], ['log:orders.inventory-decode']] },
    { id: 'needs-prep-minutes', kind: 'condition', textKey: 'variant.d.factor.prepMinutes', requiredEvidence: [['runbook:inventory-api']] },
    { id: 'rollback-unchecked', kind: 'latent', textKey: 'variant.d.factor.unchecked', requiredEvidence: [['log:inventory.deploy-rollout']] },
  ],
} satisfies Record<string, FactorInput[]>;

const tonightsDistractors = [
  { id: 'orders-deploy', textKey: 'distractor.ordersDeploy' },
  { id: 'export-cpu', textKey: 'distractor.exportCpu' },
  { id: 'crawler', textKey: 'distractor.crawler' },
  { id: 'cache-refresh', textKey: 'distractor.cacheRefresh' },
];

function distractors(own: keyof typeof factors) {
  const others = (Object.keys(factors) as (keyof typeof factors)[]).filter((k) => k !== own);
  return [...tonightsDistractors, ...others.flatMap((k) => factors[k].map((f) => ({ id: f.id, textKey: f.textKey })))];
}

function chain(nodes: NonNullable<VariantInput['causalChain']>['nodes'], edges: [string, string][]) {
  return { nodes, edges: edges.map(([from, to]) => ({ from, to })) };
}

const symptom = [
  { id: 'errors', kind: 'symptom', labelKey: 'chain.errors' },
  { id: 'customers', kind: 'impact', labelKey: 'chain.customers' },
] as const;

// A: inventory-api changes the shape of its answer and orders-api cannot read it.
const a = night(
  inventoryDeploy('deploy-inventory-430', at(2, 44), '4.3.0', 'variant.a.change.inventory', 0),
  ordersDeploy('deploy-orders-7120', at(2, 47), '7.12.0', 'variant.a.change.orders'),
  flag('flag-free-delivery', at(1, 5), 'promos.free-delivery-banner', 'growth', 'p.ortega', 'variant.a.change.flag', 30),
  dbConfig('cfg-pg-v31', evening(23, 30), 'autovacuum_vacuum_scale_factor', 0.2, 0.05, 'pg-v31', 'DBA-412', 'variant.a.change.config', 40),
  revert('deploy-inventory-430', 'rollback-inventory-430', 6),
);

const variantA: VariantInput = {
  id: 'a',
  changes: a.changes,
  effects: [
    ...background, lockWaits, ...a.landings,
    { id: 'inventory-new-shape', component: 'orders-api', param: 'errorRatio', op: 'set', value: 0.14, from: a.landsAt.inventory, rampMin: 3, removedBy: ['rollback-inventory-430'] },
  ],
  logs: [
    ...a.landingLogs,
    { id: 'orders.inventory-decode', component: 'orders-api', severity: 'ERROR', body: 'POST /orders failed: cannot decode inventory-api GET /availability response: missing field "available" order={orderId}', trigger: { kind: 'serverError' } },
  ],
  mitigations: a.mitigations,
  factors: factors.a,
  distractorFactors: distractors('a'),
  causalChain: chain(
    [
      { id: 'no-contract', kind: 'latent', labelKey: 'variant.a.chain.noContract', factor: 'no-contract-test' },
      { id: 'change', kind: 'change', labelKey: 'variant.a.chain.change', factor: 'inventory-shape' },
      { id: 'strict', kind: 'condition', labelKey: 'variant.a.chain.strict', factor: 'strict-decode' },
      { id: 'decode', kind: 'condition', labelKey: 'variant.a.chain.decode' },
      ...symptom,
    ],
    [['no-contract', 'change'], ['change', 'decode'], ['strict', 'decode'], ['decode', 'errors'], ['errors', 'customers']],
  ),
  solution: {
    steps: [
      { tool: 'changes' },
      { tool: 'metrics', query: callOutcomes },
      { tool: 'logs', filter: 'service:orders-api level:error' },
      { tool: 'logs', filter: 'service:inventory-api "rollout"' },
    ],
    mitigation: 'rollback-inventory-430',
  },
  debriefNoteKey: 'variant.a.debriefNote',
};

// B: another team turns on a migration flag and every order's second write can fail.
const b = night(
  inventoryDeploy('deploy-inventory-423', at(0, 55), '4.2.3', 'variant.b.change.inventory', 30),
  ordersDeploy('deploy-orders-7121', at(2, 48), '7.12.1', 'variant.b.change.orders'),
  flag('flag-dual-write-v2', at(2, 45), 'orders.dual-write-v2', 'data-platform', 'k.navarro', 'variant.b.change.flag', 0),
  dbConfig('cfg-pg-v32', at(0, 20), 'work_mem', '16MB', '32MB', 'pg-v32', 'DBA-415', 'variant.b.change.config', 30),
  revert('deploy-inventory-423', 'rollback-inventory-423', 6),
);

const variantB: VariantInput = {
  id: 'b',
  changes: b.changes,
  effects: [
    ...background, lockWaits, ...b.landings,
    { id: 'v2-rejects', component: 'orders-db', param: 'errorRatio', op: 'set', value: 0.13, from: b.landsAt.flag, rampMin: 2, removedBy: ['revert-flag-dual-write-v2'] },
  ],
  logs: [
    ...b.landingLogs,
    { id: 'orders.write-failed', component: 'orders-api', severity: 'ERROR', body: 'POST /orders failed: INSERT orders_v2 rejected: null value in column "kitchen_tz" violates not-null constraint order={orderId}', trigger: { kind: 'serverError' } },
    { id: 'db.error', component: 'orders-db', severity: 'ERROR', body: 'ERROR: null value in column "kitchen_tz" of relation "orders_v2" violates not-null constraint (dual-write)', trigger: { kind: 'rate', perMin: 5, followsEffect: 'v2-rejects' } },
  ],
  mitigations: b.mitigations,
  factors: factors.b,
  distractorFactors: distractors('b'),
  causalChain: chain(
    [
      { id: 'unannounced', kind: 'latent', labelKey: 'variant.b.chain.unannounced', factor: 'unannounced-flag' },
      { id: 'change', kind: 'change', labelKey: 'variant.b.chain.change', factor: 'dual-write-flag' },
      { id: 'constraint', kind: 'condition', labelKey: 'variant.b.chain.constraint', factor: 'v2-constraint' },
      { id: 'rejected', kind: 'condition', labelKey: 'variant.b.chain.rejected' },
      ...symptom,
    ],
    [['unannounced', 'change'], ['change', 'rejected'], ['constraint', 'rejected'], ['rejected', 'errors'], ['errors', 'customers']],
  ),
  solution: {
    steps: [
      { tool: 'changes' },
      { tool: 'logs', filter: 'service:orders-api level:error' },
      { tool: 'logs', filter: 'service:orders-db level:error' },
      { tool: 'logs', filter: 'service:orders-api "feature flag"' },
    ],
    mitigation: 'revert-flag-dual-write-v2',
  },
  debriefNoteKey: 'variant.b.debriefNote',
};

// C: a database setting from the evening is harmless until the nightly export takes its locks.
const c = night(
  inventoryDeploy('deploy-inventory-424', at(1, 25), '4.2.4', 'variant.c.change.inventory', 30),
  ordersDeploy('deploy-orders-7122', at(2, 44), '7.12.2', 'variant.c.change.orders'),
  flag('flag-photo-carousel', at(0, 35), 'menu.photo-carousel', 'growth', 'p.ortega', 'variant.c.change.flag', 30),
  dbConfig('cfg-pg-v33', evening(23, 10), 'lock_timeout', '5s', '200ms', 'pg-v33', 'DBA-418', 'variant.c.change.config', 0),
  revert('deploy-inventory-424', 'rollback-inventory-424', 6),
);

const variantC: VariantInput = {
  id: 'c',
  changes: c.changes,
  effects: [
    ...background, ...c.landings,
    { id: 'insert-lock-timeouts', component: 'orders-db', param: 'errorRatio', op: 'set', value: 0.12, from: EXPORT_FROM, until: EXPORT_UNTIL, rampMin: 10, removedBy: ['revert-cfg-pg-v33'] },
  ],
  logs: [
    ...c.landingLogs,
    { id: 'orders.write-failed', component: 'orders-api', severity: 'ERROR', body: 'POST /orders failed: INSERT orders: canceling statement due to lock timeout order={orderId}', trigger: { kind: 'serverError' } },
    { id: 'db.error', component: 'orders-db', severity: 'ERROR', body: 'ERROR: canceling statement due to lock timeout (lock_timeout=200ms) STATEMENT: INSERT INTO orders ...', trigger: { kind: 'rate', perMin: 5, followsEffect: 'insert-lock-timeouts' } },
  ],
  mitigations: c.mitigations,
  factors: factors.c,
  distractorFactors: distractors('c'),
  causalChain: chain(
    [
      { id: 'staging', kind: 'latent', labelKey: 'variant.c.chain.staging', factor: 'staging-without-jobs' },
      { id: 'change', kind: 'change', labelKey: 'variant.c.chain.change', factor: 'lock-timeout' },
      { id: 'export', kind: 'condition', labelKey: 'variant.c.chain.export', factor: 'export-locks' },
      { id: 'give-up', kind: 'condition', labelKey: 'variant.c.chain.giveUp' },
      ...symptom,
    ],
    [['staging', 'change'], ['change', 'give-up'], ['export', 'give-up'], ['give-up', 'errors'], ['errors', 'customers']],
  ),
  solution: {
    steps: [
      { tool: 'changes' },
      { tool: 'logs', filter: 'service:orders-db level:error' },
      { tool: 'logs', filter: 'service:export-job "batch"' },
      { tool: 'logs', filter: 'service:orders-db "parameter reload" since:5h' },
    ],
    mitigation: 'revert-cfg-pg-v33',
  },
  debriefNoteKey: 'variant.c.debriefNote',
};

// D: someone rolls inventory-api back and takes away a field orders-api needs.
const d = night(
  inventoryDeploy('deploy-inventory-413', at(2, 43), '4.1.3', 'variant.d.change.inventory', 0, 'rollout 4.1.3 (rollback from 4.2.2): 3/3 instances updated in one step, pipeline checks skipped for rollbacks'),
  ordersDeploy('deploy-orders-7123', at(2, 46), '7.12.3', 'variant.d.change.orders'),
  flag('flag-tip-suggestions', at(1, 40), 'checkout.tip-suggestions', 'growth', 'p.ortega', 'variant.d.change.flag', 30),
  dbConfig('cfg-pg-v34', evening(23, 50), 'log_min_duration_statement', '1s', '500ms', 'pg-v34', 'DBA-420', 'variant.d.change.config', 30),
  revert('deploy-inventory-413', 'rollforward-inventory-422', 6),
);

const variantD: VariantInput = {
  id: 'd',
  changes: d.changes,
  effects: [
    ...background, lockWaits, ...d.landings,
    { id: 'inventory-old-shape', component: 'orders-api', param: 'errorRatio', op: 'set', value: 0.13, from: d.landsAt.inventory, rampMin: 3, removedBy: ['rollforward-inventory-422'] },
  ],
  logs: [
    ...d.landingLogs,
    { id: 'orders.inventory-decode', component: 'orders-api', severity: 'ERROR', body: 'POST /orders failed: cannot decode inventory-api GET /availability response: missing field "prep_minutes" order={orderId}', trigger: { kind: 'serverError' } },
  ],
  mitigations: d.mitigations,
  factors: factors.d,
  distractorFactors: distractors('d'),
  causalChain: chain(
    [
      { id: 'unchecked', kind: 'latent', labelKey: 'variant.d.chain.unchecked', factor: 'rollback-unchecked' },
      { id: 'change', kind: 'change', labelKey: 'variant.d.chain.change', factor: 'inventory-rollback' },
      { id: 'needs', kind: 'condition', labelKey: 'variant.d.chain.needs', factor: 'needs-prep-minutes' },
      { id: 'decode', kind: 'condition', labelKey: 'variant.d.chain.decode' },
      ...symptom,
    ],
    [['unchecked', 'change'], ['change', 'decode'], ['needs', 'decode'], ['decode', 'errors'], ['errors', 'customers']],
  ),
  solution: {
    steps: [
      { tool: 'changes' },
      { tool: 'logs', filter: 'service:orders-api level:error' },
      { tool: 'logs', filter: 'service:inventory-api "rollout"' },
      { tool: 'runbook', runbook: 'inventory-api' },
    ],
    mitigation: 'rollforward-inventory-422',
  },
  debriefNoteKey: 'variant.d.debriefNote',
};

export const case02: CaseInput = {
  id: 'case-02',
  version: 1,
  order: 2,
  date: '2026-04-18',
  historyFrom: at(-2, 0),
  budgetMin: 90,
  dawn: { beginsAt: at(5, 45), sunriseAt: at(6, 40) },
  traffic: { entry: 'web-gateway', peakRps: 22, troughRps: 2, peakHour: 21, wobble: 0.08 },
  components: [
    {
      id: 'web-gateway', kind: 'service', instances: 3, operation: 'POST /api/orders',
      latency: { medianMs: 12, sigma: 0.3 }, cpu: { base: 0.05, perRps: 0.01 }, memoryMb: 384,
      calls: [{ id: 'gateway.orders', to: 'orders-api', operation: 'POST /orders', timeoutMs: 10000, maxAttempts: 1 }],
    },
    {
      id: 'orders-api', kind: 'service', instances: 6, operation: 'POST /orders',
      latency: { medianMs: 45, sigma: 0.35 }, cpu: { base: 0.07, perRps: 0.025 }, memoryMb: 640,
      calls: [
        { id: 'orders.inventory', to: 'inventory-api', operation: 'GET /availability', timeoutMs: 800, maxAttempts: 2 },
        { id: 'orders.db', to: 'orders-db', operation: 'INSERT orders', timeoutMs: 3000, maxAttempts: 1 },
      ],
    },
    {
      id: 'inventory-api', kind: 'service', instances: 3, operation: 'GET /availability',
      latency: { medianMs: 18, sigma: 0.3 }, cpu: { base: 0.05, perRps: 0.012 }, memoryMb: 448,
      calls: [{ id: 'inventory.cache', to: 'inventory-cache', operation: 'GET dish:*', timeoutMs: 50, maxAttempts: 1 }],
    },
    { id: 'inventory-cache', kind: 'cache', operation: 'GET', latency: { medianMs: 1, sigma: 0.3 }, cpu: { base: 0.04, perRps: 0.004 }, memoryMb: 1024 },
    { id: 'orders-db', kind: 'database', operation: 'INSERT', latency: { medianMs: 7, sigma: 0.4 }, cpu: { base: 0.2, perRps: 0.01 }, memoryMb: 16384 },
    { id: 'export-job', kind: 'service', instances: 1, operation: 'export orders', latency: { medianMs: 1000, sigma: 0.2 }, cpu: { base: 0.02, perRps: 0 }, memoryMb: 512 },
  ],
  config: {
    'orders-db': { lock_timeout: '5s', autovacuum_vacuum_scale_factor: 0.2, work_mem: '16MB', log_min_duration_statement: '1s' },
  },
  logs: [
    {
      id: 'gateway.upstream-5xx', component: 'web-gateway', severity: 'ERROR',
      body: 'POST /api/orders: upstream orders-api returned 500 order={orderId}',
      trigger: { kind: 'serverError' },
    },
    { id: 'gateway.health', component: 'web-gateway', severity: 'DEBUG', body: 'GET /healthz 200 in {int:1-4}ms', trigger: { kind: 'rate', perMin: 6 } },
    { id: 'gateway.rate-limit', component: 'web-gateway', severity: 'WARN', body: 'rate limit: throttled {int:40-160} requests from one client (user-agent PriceBot/2.1)', trigger: { kind: 'rate', perMin: 2, from: at(2, 5), until: at(2, 25), followsEffect: 'gateway-crawler' } },
    { id: 'inventory.cache-ratio', component: 'inventory-api', severity: 'INFO', body: 'dish cache hit ratio {int:91-97}% over last 60s', trigger: { kind: 'rate', perMin: 1 } },
    { id: 'cache.refresh', component: 'inventory-cache', severity: 'INFO', body: 'menu refresh: {int:18-42}k dish keys rewritten', trigger: { kind: 'rate', perMin: 2, from: at(1, 30), until: at(1, 44), followsEffect: 'menu-cache-refresh' } },
    { id: 'db.checkpoint', component: 'orders-db', severity: 'INFO', body: 'checkpoint complete: wrote {int:800-4000} buffers', trigger: { kind: 'rate', perMin: 0.2 } },
    { id: 'export.started', component: 'export-job', severity: 'INFO', body: 'nightly export started: orders of 2026-04-17 → warehouse, 60 batches, reading from primary orders-db-0', trigger: { kind: 'rate', perMin: 1, from: EXPORT_FROM, until: EXPORT_FROM + 1, followsEffect: 'nightly-export' } },
    { id: 'export.batch', component: 'export-job', severity: 'INFO', body: 'batch {int:1-60}/60 copied: LOCK TABLE orders IN SHARE MODE held {int:900-2800}ms', trigger: { kind: 'rate', perMin: 1.5, followsEffect: 'nightly-export' } },
  ],
  alert: {
    id: 'orders-5xx-ratio',
    expr: `${errorRatio} > 0.05`,
    forMin: 5,
    summaryKey: 'alert.summary',
  },
  page: { at: at(2, 52) },
  impact: { slowMs: 4000, uniqueUserRatio: 0.8 },
  tools: {
    costs: { metrics: 2, dashboard: 3, logs: 3, traces: 3, trace: 1, changes: 2, runbook: 2, map: 1, statusUpdate: 3 },
    dashboards: [
      {
        id: 'orders-overview',
        titleKey: 'dashboard.orders',
        panels: [
          { titleKey: 'panel.ordersErrors', unit: 'ratio', query: errorRatio },
          { titleKey: 'panel.ordersRate', unit: 'rps', query: 'sum by (status_class) (rate(http_server_requests_total{service="orders-api"}[5m]))' },
          { titleKey: 'panel.ordersCalls', unit: 'rps', query: callOutcomes },
          { titleKey: 'panel.dbCpu', unit: 'ratio', query: 'max by (service) (process_cpu_utilization_ratio{service="orders-db"})' },
        ],
      },
    ],
    runbooks: [
      { id: 'orders-errors', titleKey: 'runbook.ordersErrors.title', bodyKey: 'runbook.ordersErrors.body' },
      { id: 'inventory-api', titleKey: 'runbook.inventory.title', bodyKey: 'runbook.inventory.body' },
      { id: 'orders-db', titleKey: 'runbook.ordersDb.title', bodyKey: 'runbook.ordersDb.body' },
    ],
  },
  stakeholderPrompts: [{ id: 'renata-0310', at: at(3, 10), fromKey: 'prompt.renata.from', askKey: 'prompt.renata.ask' }],
  variants: [variantA, variantB, variantC, variantD],
  readNext: ['sre-book-incident', 'how-complex-systems-fail'],
};

export default case02;
