import type { CaseInput, VariantInput } from '../../../engine/case-schema';

const at = (hh: number, mm: number) => hh * 60 + mm;
const evening = (hh: number, mm: number) => at(hh - 24, mm);

type ChangeInput = NonNullable<VariantInput['changes']>[number];
type EffectInput = NonNullable<VariantInput['effects']>[number];
type LogInput = NonNullable<VariantInput['logs']>[number];
type FactorInput = NonNullable<VariantInput['factors']>[number];
type MitigationInput = NonNullable<VariantInput['mitigations']>[number];

const SYNC_FROM = at(2, 30);
const SYNC_UNTIL = at(4, 40);
const sync = { from: SYNC_FROM, until: SYNC_UNTIL, rampMin: 3 };
const dbCall = { component: 'bookings-api', call: 'bookings.db' };

// Every night at 02:30 rates-sync rewrites availability in rooms-cache: evictions, a hot cache and more misses, whatever else goes wrong.
const background: EffectInput[] = [
  { id: 'rates-sync', component: 'rates-sync', param: 'cpu', op: 'add', value: 0.55, ...sync },
  { id: 'rates-sync-cache-cpu', component: 'rooms-cache', param: 'cpu', op: 'add', value: 0.45, ...sync },
  { id: 'rates-sync-db-cpu', component: 'bookings-db', param: 'cpu', op: 'add', value: 0.12, ...sync },
  { id: 'rates-sync-misses', ...dbCall, param: 'calls.perRequest', op: 'mul', value: 1.49, ...sync },
  { id: 'partner-crawl', component: 'edge', param: 'cpu', op: 'add', value: 0.14, from: at(1, 10), until: at(1, 35), rampMin: 3, jitterMin: 25 },
  { id: 'db-autovacuum', component: 'bookings-db', param: 'cpu', op: 'add', value: 0.1, from: at(0, 40), until: at(0, 55), rampMin: 2, jitterMin: 30 },
];

// A change costs the component it lands on a minute of CPU; sharing the change's id and jitter keeps that minute, and its log, where the change is.
function landing(change: ChangeInput, component: string): EffectInput {
  return { id: change.id, component, param: 'cpu', op: 'add', value: 0.03, from: change.at, until: change.at + 1, jitterMin: change.jitterMin ?? 0 };
}

type LandingLogId = 'bookings.deploy-rollout' | 'bookings.pool-reload' | 'bookings.cache-reload' | 'rates-sync.deploy-rollout';

function landingLog(id: LandingLogId, component: string, change: ChangeInput, body: string): LogInput {
  return { id, component, severity: 'INFO', body, trigger: { kind: 'rate', perMin: 2, from: change.at, until: change.at + 1, followsEffect: change.id } };
}

type Landed = { change: ChangeInput; effect: EffectInput; log: LogInput };

function bookingsDeploy(id: string, minute: number, version: string, jitterMin: number): Landed {
  const change: ChangeInput = { kind: 'deploy', id, at: minute, component: 'bookings-api', version, author: 'a.canul', messageKey: `change.${id}`, jitterMin };
  const log = landingLog('bookings.deploy-rollout', 'bookings-api', change, `rollout ${version}: 2/2 instances updated, checks: unit tests + smoke test (20 requests against one instance)`);
  return { change, effect: landing(change, 'bookings-api'), log };
}

// Pool and cache settings are separate files in bookings-api's config, each with its own versions.
const versionOf = (id: string) => id.replace('cfg-', '');

function poolConfig(id: string, minute: number, key: string, from: number, to: number, ticket: string, jitterMin: number): Landed {
  const version = versionOf(id);
  const change: ChangeInput = { kind: 'config', id, at: minute, component: 'bookings-api', key, from, to, version, author: 'm.pech', ticket, messageKey: `change.${id}`, jitterMin };
  const log = landingLog('bookings.pool-reload', 'bookings-api', change, `config reload ${version}: ${key} = ${to} (was ${from}), bookings-db pool rebuilt on 2/2 instances, checks: schema only`);
  return { change, effect: landing(change, 'bookings-api'), log };
}

function cacheConfig(id: string, minute: number, key: string, from: number | string, to: number | string, ticket: string, jitterMin: number): Landed {
  const version = versionOf(id);
  const change: ChangeInput = { kind: 'config', id, at: minute, component: 'bookings-api', key, from, to, version, author: 'r.dzib', ticket, messageKey: `change.${id}`, jitterMin };
  const log = landingLog('bookings.cache-reload', 'bookings-api', change, `config reload ${version}: ${key} = ${to} (was ${from}), applied to 2/2 instances, checks: schema only`);
  return { change, effect: landing(change, 'bookings-api'), log };
}

function syncDeploy(id: string, minute: number, version: string, jitterMin: number): Landed {
  const change: ChangeInput = { kind: 'deploy', id, at: minute, component: 'rates-sync', version, author: 'l.chi', messageKey: `change.${id}`, jitterMin };
  const log = landingLog('rates-sync.deploy-rollout', 'rates-sync', change, `rollout ${version}: 1/1 instance updated, next run at 02:30`);
  return { change, effect: landing(change, 'rates-sync'), log };
}

const restart: MitigationInput = { id: 'restart-bookings', costMin: 4, actions: [{ type: 'restart', component: 'bookings-api' }] };
const scale: MitigationInput = { id: 'scale-bookings', costMin: 8, actions: [{ type: 'scale', component: 'bookings-api', instances: 4 }] };
const revert = (change: string, id: string, costMin: number): MitigationInput => ({ id, costMin, actions: [{ type: 'revertChange', change }] });

// Every night has the same four kinds of change and the same five actions, so the panels never say which night it is.
function night(deploy: Landed, pool: Landed, cache: Landed, elsewhere: Landed) {
  const landed = [deploy, pool, cache, elsewhere];
  return {
    changes: landed.map((l) => l.change),
    landings: landed.map((l) => l.effect),
    landingLogs: landed.map((l) => l.log),
    mitigations: [
      revert(deploy.change.id, `rollback-${deploy.change.id.replace('deploy-', '')}`, 6),
      revert(pool.change.id, `revert-${pool.change.id}`, 3),
      revert(cache.change.id, `revert-${cache.change.id}`, 3),
      restart,
      scale,
    ],
  };
}

// The cache's own report, every minute: normal before the sync, lower during it, and on one night lower still.
function hitRatioLogs(lowFrom?: { at: number; effect: string }): LogInput[] {
  const ratio = (id: string, range: string, trigger: LogInput['trigger']): LogInput => ({
    id, component: 'bookings-api', severity: 'INFO', body: `availability cache hit ratio ${range}% over last 60s`, trigger,
  });
  return [
    ratio('bookings.cache-ratio', '{int:94-97}', { kind: 'rate', perMin: 1, until: SYNC_FROM }),
    ratio('bookings.cache-ratio-sync', '{int:78-84}', { kind: 'rate', perMin: 1, followsEffect: 'rates-sync-misses', ...(lowFrom ? { until: lowFrom.at } : {}) }),
    ...(lowFrom ? [ratio('bookings.cache-ratio-low', '{int:36-44}', { kind: 'rate', perMin: 1, followsEffect: lowFrom.effect })] : []),
  ];
}

const p99 = 'histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket{service="bookings-api"}[5m])))';
const poolUsage = 'sum by (state) (db_client_connections_usage{service="bookings-api"})';
const poolWait = 'histogram_quantile(0.99, sum by (le) (rate(db_client_connections_wait_time_seconds_bucket{service="bookings-api"}[5m])))';
const poolUse = 'histogram_quantile(0.99, sum by (le) (rate(db_client_connections_use_time_seconds_bucket{service="bookings-api"}[5m])))';
const queriesPerRequest = 'sum(rate(http_client_requests_total{service="bookings-api", peer_service="bookings-db"}[5m])) / sum(rate(http_server_requests_total{service="bookings-api"}[5m]))';

const poolFull = ['metric:db_client_connections_usage:bookings-api', 'metric:db_client_connections_wait_time_seconds:bookings-api', 'log:bookings.pool-timeout'];

// The causes of tonight's variant, and of every other one: each night's real factors are the other nights' distractors.
const factors = {
  a: [
    { id: 'rates-in-transaction', kind: 'trigger', textKey: 'variant.a.factor.ratesInTx', requiredEvidence: [['change:deploy-bookings-580'], ['metric:db_client_connections_use_time_seconds:bookings-api']] },
    { id: 'pool-held-full', kind: 'condition', textKey: 'variant.a.factor.heldFull', requiredEvidence: [poolFull] },
    { id: 'smoke-at-a-trickle', kind: 'latent', textKey: 'variant.a.factor.trickle', requiredEvidence: [['log:bookings.deploy-rollout']] },
  ],
  b: [
    { id: 'pool-shrunk', kind: 'trigger', textKey: 'variant.b.factor.shrunk', requiredEvidence: [['change:cfg-pool-v18'], ['metric:db_client_connections_max:bookings-api']] },
    { id: 'demand-over-ten', kind: 'condition', textKey: 'variant.b.factor.demand', requiredEvidence: [poolFull] },
    { id: 'pool-unchecked', kind: 'latent', textKey: 'variant.b.factor.unchecked', requiredEvidence: [['log:bookings.pool-reload']] },
  ],
  c: [
    { id: 'leak-deploy', kind: 'trigger', textKey: 'variant.c.factor.leak', requiredEvidence: [['change:deploy-bookings-582'], ['log:bookings.pool-leak']] },
    { id: 'leaks-pile-up', kind: 'condition', textKey: 'variant.c.factor.pileUp', requiredEvidence: [['metric:db_client_connections_usage:bookings-api']] },
    { id: 'leak-warn-only', kind: 'latent', textKey: 'variant.c.factor.warnOnly', requiredEvidence: [['runbook:bookings-pool']] },
  ],
  d: [
    { id: 'ttl-lowered', kind: 'trigger', textKey: 'variant.d.factor.ttl', requiredEvidence: [['change:cfg-cache-v42'], ['log:bookings.cache-ratio-low']] },
    { id: 'misses-to-db', kind: 'condition', textKey: 'variant.d.factor.misses', requiredEvidence: [['metric:http_client_requests_total:bookings-api']] },
    { id: 'ttl-unchecked', kind: 'latent', textKey: 'variant.d.factor.unchecked', requiredEvidence: [['log:bookings.cache-reload']] },
  ],
} satisfies Record<string, FactorInput[]>;

const tonightsDistractors = [
  { id: 'cache-eviction', textKey: 'distractor.cacheEviction' },
  { id: 'rates-sync-deploy', textKey: 'distractor.ratesSync' },
  { id: 'db-slow', textKey: 'distractor.dbSlow' },
  { id: 'partner-crawl', textKey: 'distractor.crawl' },
];

function distractors(own: keyof typeof factors) {
  const others = (Object.keys(factors) as (keyof typeof factors)[]).filter((k) => k !== own);
  return [...tonightsDistractors, ...others.flatMap((k) => factors[k].map((f) => ({ id: f.id, textKey: f.textKey })))];
}

function chain(nodes: NonNullable<VariantInput['causalChain']>['nodes'], edges: [string, string][]) {
  return { nodes, edges: edges.map(([from, to]) => ({ from, to })) };
}

const symptom = [
  { id: 'exhausted', kind: 'condition', labelKey: 'chain.exhausted' },
  { id: 'p99', kind: 'symptom', labelKey: 'chain.p99' },
  { id: 'partners', kind: 'impact', labelKey: 'chain.partners' },
] as const;
const symptomEdges: [string, string][] = [['exhausted', 'p99'], ['p99', 'partners']];

const poolTimeoutLog: LogInput = {
  id: 'bookings.pool-timeout', component: 'bookings-api', severity: 'ERROR',
  body: 'GET /availability failed: could not acquire connection in {elapsedMs} ms (pool bookings-db)',
  trigger: { kind: 'poolTimeout', call: 'bookings.db' },
};

// A: a release reads rates from channel-mgr inside the database transaction, so every connection is held for that call too.
const a = night(
  bookingsDeploy('deploy-bookings-580', at(2, 44), '5.8.0', 0),
  poolConfig('cfg-pool-v17', at(2, 48), 'db.pool.idle_timeout_ms', 600000, 300000, 'PLAT-902', 0),
  cacheConfig('cfg-cache-v40', at(1, 35), 'cache.client.timeout_ms', 50, 80, 'PLAT-897', 30),
  syncDeploy('deploy-sync-241', at(0, 50), '2.4.1', 30),
);

const variantA: VariantInput = {
  id: 'a',
  changes: a.changes,
  effects: [
    ...background, ...a.landings,
    { id: 'rates-held', ...dbCall, param: 'pool.holdMs', op: 'add', value: 95, from: at(2, 44), removedBy: ['rollback-bookings-580'] },
  ],
  logs: [...a.landingLogs, ...hitRatioLogs()],
  mitigations: a.mitigations,
  factors: factors.a,
  distractorFactors: distractors('a'),
  causalChain: chain(
    [
      { id: 'trickle', kind: 'latent', labelKey: 'variant.a.chain.trickle', factor: 'smoke-at-a-trickle' },
      { id: 'change', kind: 'change', labelKey: 'variant.a.chain.change', factor: 'rates-in-transaction' },
      { id: 'held', kind: 'condition', labelKey: 'variant.a.chain.held', factor: 'pool-held-full' },
      ...symptom,
    ],
    [['trickle', 'change'], ['change', 'held'], ['held', 'exhausted'], ...symptomEdges],
  ),
  solution: {
    steps: [
      { tool: 'changes' },
      { tool: 'metrics', query: poolUsage },
      { tool: 'metrics', query: poolUse },
      { tool: 'logs', filter: 'service:bookings-api "rollout"' },
    ],
    mitigation: 'rollback-bookings-580',
  },
  debriefNoteKey: 'variant.a.debriefNote',
};

// B: someone shrinks the pool to save connections; with fewer than the queries need, they queue and time out.
const b = night(
  bookingsDeploy('deploy-bookings-581', at(2, 36), '5.8.1', 0),
  poolConfig('cfg-pool-v18', at(2, 42), 'db.pool.max_size', 40, 10, 'PLAT-905', 0),
  cacheConfig('cfg-cache-v41', at(0, 20), 'cache.client.compression', 'off', 'lz4', 'PLAT-899', 30),
  syncDeploy('deploy-sync-242', at(2, 5), '2.4.2', 15),
);

const variantB: VariantInput = {
  id: 'b',
  changes: b.changes,
  effects: [...background, ...b.landings],
  logs: [...b.landingLogs, ...hitRatioLogs()],
  mitigations: b.mitigations,
  factors: factors.b,
  distractorFactors: distractors('b'),
  causalChain: chain(
    [
      { id: 'unchecked', kind: 'latent', labelKey: 'variant.b.chain.unchecked', factor: 'pool-unchecked' },
      { id: 'change', kind: 'change', labelKey: 'variant.b.chain.change', factor: 'pool-shrunk' },
      { id: 'demand', kind: 'condition', labelKey: 'variant.b.chain.demand', factor: 'demand-over-ten' },
      ...symptom,
    ],
    [['unchecked', 'change'], ['change', 'exhausted'], ['demand', 'exhausted'], ...symptomEdges],
  ),
  solution: {
    steps: [
      { tool: 'changes' },
      { tool: 'metrics', query: poolWait },
      { tool: 'metrics', query: 'sum(db_client_connections_max{service="bookings-api"})' },
      { tool: 'logs', filter: 'service:bookings-api "config reload"' },
    ],
    mitigation: 'revert-cfg-pool-v18',
  },
  debriefNoteKey: 'variant.b.debriefNote',
};

// C: a release never returns its connection on one early return; a restart frees them and the leak starts over.
const c = night(
  bookingsDeploy('deploy-bookings-582', at(2, 33), '5.8.2', 0),
  poolConfig('cfg-pool-v19', evening(23, 40), 'db.pool.max_lifetime_ms', 1800000, 900000, 'PLAT-893', 40),
  cacheConfig('cfg-cache-v43', at(2, 38), 'cache.availability.ttl_s', 300, 600, 'PLAT-907', 0),
  syncDeploy('deploy-sync-243', at(1, 20), '2.4.3', 30),
);
const LEAK_PER_MIN = 1.25;

const variantC: VariantInput = {
  id: 'c',
  changes: c.changes,
  effects: [
    ...background, ...c.landings,
    { id: 'connection-leak', ...dbCall, param: 'pool.leaked', op: 'add', value: 0, growthPerMin: LEAK_PER_MIN, from: at(2, 33), resetBy: ['restart-bookings'], removedBy: ['rollback-bookings-582'] },
  ],
  logs: [
    ...c.landingLogs, ...hitRatioLogs(),
    {
      id: 'bookings.pool-leak', component: 'bookings-api', severity: 'WARN',
      body: 'connection leak detection triggered: bookings-db connection checked out by GET /availability {int:30-34}s ago and never returned (leakDetectionThreshold=30000ms)',
      trigger: { kind: 'rate', perMin: LEAK_PER_MIN * 2, followsEffect: 'connection-leak' },
    },
  ],
  mitigations: c.mitigations,
  factors: factors.c,
  distractorFactors: distractors('c'),
  causalChain: chain(
    [
      { id: 'warn-only', kind: 'latent', labelKey: 'variant.c.chain.warnOnly', factor: 'leak-warn-only' },
      { id: 'change', kind: 'change', labelKey: 'variant.c.chain.change', factor: 'leak-deploy' },
      { id: 'pile-up', kind: 'condition', labelKey: 'variant.c.chain.pileUp', factor: 'leaks-pile-up' },
      ...symptom,
    ],
    [['warn-only', 'pile-up'], ['change', 'pile-up'], ['pile-up', 'exhausted'], ...symptomEdges],
  ),
  solution: {
    steps: [
      { tool: 'changes' },
      { tool: 'metrics', query: poolUsage },
      { tool: 'logs', filter: 'service:bookings-api level:warn "leak"' },
      { tool: 'runbook', runbook: 'bookings-pool' },
    ],
    mitigation: 'rollback-bookings-582',
  },
  debriefNoteKey: 'variant.c.debriefNote',
};

// D: the availability TTL drops from five minutes to thirty seconds; the misses become queries the pool cannot hold.
const d = night(
  bookingsDeploy('deploy-bookings-583', at(2, 40), '5.8.3', 0),
  poolConfig('cfg-pool-v20', at(1, 0), 'db.pool.validation_timeout_ms', 5000, 3000, 'PLAT-895', 30),
  cacheConfig('cfg-cache-v42', at(2, 45), 'cache.availability.ttl_s', 300, 30, 'PLAT-908', 0),
  syncDeploy('deploy-sync-244', at(2, 50), '2.4.4', 3),
);

const variantD: VariantInput = {
  id: 'd',
  changes: d.changes,
  effects: [
    ...background, ...d.landings,
    { id: 'short-ttl-misses', ...dbCall, param: 'calls.perRequest', op: 'mul', value: 1.93, from: at(2, 45), rampMin: 2, removedBy: ['revert-cfg-cache-v42'] },
    { id: 'short-ttl-cache-cpu', component: 'rooms-cache', param: 'cpu', op: 'add', value: 0.15, from: at(2, 45), rampMin: 2, removedBy: ['revert-cfg-cache-v42'] },
  ],
  logs: [...d.landingLogs, ...hitRatioLogs({ at: at(2, 45), effect: 'short-ttl-misses' })],
  mitigations: d.mitigations,
  factors: factors.d,
  distractorFactors: distractors('d'),
  causalChain: chain(
    [
      { id: 'unchecked', kind: 'latent', labelKey: 'variant.d.chain.unchecked', factor: 'ttl-unchecked' },
      { id: 'change', kind: 'change', labelKey: 'variant.d.chain.change', factor: 'ttl-lowered' },
      { id: 'misses', kind: 'condition', labelKey: 'variant.d.chain.misses', factor: 'misses-to-db' },
      ...symptom,
    ],
    [['unchecked', 'change'], ['change', 'misses'], ['misses', 'exhausted'], ...symptomEdges],
  ),
  solution: {
    steps: [
      { tool: 'changes' },
      { tool: 'metrics', query: queriesPerRequest },
      { tool: 'logs', filter: 'service:bookings-api "hit ratio"' },
      { tool: 'logs', filter: 'service:bookings-api "config reload"' },
    ],
    mitigation: 'revert-cfg-cache-v42',
  },
  debriefNoteKey: 'variant.d.debriefNote',
};

export const case03: CaseInput = {
  id: 'case-03',
  version: 1,
  order: 3,
  date: '2026-05-22',
  historyFrom: at(-2, 0),
  budgetMin: 90,
  dawn: { beginsAt: at(5, 25), sunriseAt: at(6, 5) },
  traffic: { entry: 'edge', peakRps: 520, troughRps: 375, peakHour: 14, wobble: 0.06 },
  components: [
    {
      id: 'edge', kind: 'service', instances: 3, operation: 'GET /v1/availability',
      latency: { medianMs: 6, sigma: 0.3 }, cpu: { base: 0.06, perRps: 0.0004 }, memoryMb: 384,
      calls: [{ id: 'edge.bookings', to: 'bookings-api', operation: 'GET /availability', timeoutMs: 5000, maxAttempts: 1 }],
    },
    {
      id: 'bookings-api', kind: 'service', instances: 2, operation: 'GET /availability',
      latency: { medianMs: 14, sigma: 0.3 }, cpu: { base: 0.1, perRps: 0.0008 }, memoryMb: 1536,
      calls: [
        { id: 'bookings.cache', to: 'rooms-cache', operation: 'MGET avail:*', timeoutMs: 50, maxAttempts: 1, configKeys: { timeoutMs: 'cache.client.timeout_ms' } },
        {
          id: 'bookings.db', to: 'bookings-db', operation: 'SELECT availability', timeoutMs: 3000, maxAttempts: 1,
          pool: { size: 40, acquireTimeoutMs: 2000 }, configKeys: { poolSize: 'db.pool.max_size' },
        },
        { id: 'bookings.rates', to: 'channel-mgr', operation: 'GET /rates', timeoutMs: 1500, maxAttempts: 1 },
      ],
    },
    { id: 'rooms-cache', kind: 'cache', operation: 'MGET', latency: { medianMs: 0.9, sigma: 0.3 }, cpu: { base: 0.12, perRps: 0.0003 }, memoryMb: 6144 },
    { id: 'bookings-db', kind: 'database', operation: 'SELECT', latency: { medianMs: 85, sigma: 0.4 }, cpu: { base: 0.18, perRps: 0.0005 }, memoryMb: 32768, maxConnections: 85 },
    {
      id: 'channel-mgr', kind: 'external', instrumented: false, operation: 'rates',
      latency: { medianMs: 90, sigma: 0.3 }, tail: { ratio: 0.002, medianMs: 1200, sigma: 0.2 }, cpu: { base: 0, perRps: 0 }, memoryMb: 1,
    },
    { id: 'rates-sync', kind: 'service', instances: 1, operation: 'sync rates', latency: { medianMs: 1000, sigma: 0.2 }, cpu: { base: 0.02, perRps: 0 }, memoryMb: 768 },
  ],
  config: {
    'bookings-api': {
      'db.pool.max_size': 40, 'db.pool.idle_timeout_ms': 600000, 'db.pool.max_lifetime_ms': 1800000, 'db.pool.validation_timeout_ms': 5000,
      'cache.availability.ttl_s': 300, 'cache.client.timeout_ms': 50, 'cache.client.compression': 'off',
    },
  },
  logs: [
    poolTimeoutLog,
    { id: 'edge.upstream-5xx', component: 'edge', severity: 'ERROR', body: 'GET /v1/availability: upstream bookings-api returned 500',trigger: { kind: 'serverError' } },
    { id: 'edge.health', component: 'edge', severity: 'DEBUG', body: 'GET /healthz 200 in {int:1-4}ms', trigger: { kind: 'rate', perMin: 6 } },
    { id: 'edge.crawl', component: 'edge', severity: 'WARN', body: 'partner throttled: {int:300-900} requests over quota from api key trivo-metasearch', trigger: { kind: 'rate', perMin: 2, followsEffect: 'partner-crawl' } },
    { id: 'rates-sync.started', component: 'rates-sync', severity: 'INFO', body: 'nightly rates sync started: 1,840 hotels, rewriting availability in rooms-cache and rates in bookings-db', trigger: { kind: 'rate', perMin: 1, from: SYNC_FROM, until: SYNC_FROM + 1, followsEffect: 'rates-sync' } },
    { id: 'rates-sync.batch', component: 'rates-sync', severity: 'INFO', body: 'batch {int:1-92}/92: {int:15-25} hotels synced, {int:9000-16000} cache keys rewritten', trigger: { kind: 'rate', perMin: 0.7, followsEffect: 'rates-sync' } },
    { id: 'cache.evictions', component: 'rooms-cache', severity: 'WARN', body: 'evicted {int:2000-9000} keys in 10s: used_memory reached maxmemory 6gb (maxmemory-policy allkeys-lru)', trigger: { kind: 'rate', perMin: 6, followsEffect: 'rates-sync-cache-cpu' } },
    { id: 'db.autovacuum', component: 'bookings-db', severity: 'INFO', body: 'automatic vacuum of table "bookings.rate_plans": {int:4-12} pages removed', trigger: { kind: 'rate', perMin: 1, followsEffect: 'db-autovacuum' } },
  ],
  alert: { id: 'bookings-p99-latency', expr: `${p99} > 1.5`, forMin: 5, summaryKey: 'alert.summary' },
  page: { at: at(2, 58) },
  impact: { slowMs: 1500, uniqueUserRatio: 0.02 },
  tools: {
    costs: { metrics: 2, dashboard: 3, logs: 3, traces: 3, trace: 1, changes: 2, runbook: 2, map: 1, statusUpdate: 3 },
    dashboards: [
      {
        id: 'bookings-overview',
        titleKey: 'dashboard.bookings',
        panels: [
          { titleKey: 'panel.p99', unit: 'seconds', query: p99 },
          { titleKey: 'panel.rate', unit: 'rps', query: 'sum by (status_class) (rate(http_server_requests_total{service="bookings-api"}[5m]))' },
          { titleKey: 'panel.poolUsage', unit: 'count', query: poolUsage },
          { titleKey: 'panel.poolWait', unit: 'seconds', query: poolWait },
          { titleKey: 'panel.cacheCpu', unit: 'ratio', query: 'max by (service) (process_cpu_utilization_ratio{service="rooms-cache"})' },
        ],
      },
    ],
    runbooks: [
      { id: 'bookings-latency', titleKey: 'runbook.latency.title', bodyKey: 'runbook.latency.body' },
      { id: 'bookings-pool', titleKey: 'runbook.pool.title', bodyKey: 'runbook.pool.body' },
      { id: 'rooms-cache', titleKey: 'runbook.cache.title', bodyKey: 'runbook.cache.body' },
    ],
  },
  stakeholderPrompts: [{ id: 'valeria-0315', at: at(3, 15), fromKey: 'prompt.valeria.from', askKey: 'prompt.valeria.ask' }],
  variants: [variantA, variantB, variantC, variantD],
  readNext: ['use-method', 'sre-book-incident'],
};

export default case03;
