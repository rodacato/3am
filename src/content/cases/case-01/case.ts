import type { CaseInput, VariantInput } from '../../../engine/case-schema';

const at = (hh: number, mm: number) => hh * 60 + mm;

type ChangeInput = NonNullable<VariantInput['changes']>[number];
type EffectInput = NonNullable<VariantInput['effects']>[number];
type LogInput = NonNullable<VariantInput['logs']>[number];
type FactorInput = NonNullable<VariantInput['factors']>[number];
type MitigationInput = NonNullable<VariantInput['mitigations']>[number];

// Every night has the same kinds of change and the same four actions, so the panels never say which night it is.
const cartDeploy: ChangeInput = { kind: 'deploy', id: 'deploy-cart-381', at: at(1, 12), component: 'cart-api', version: '3.8.1', author: 'ci-bot', messageKey: 'change.deployCart', jitterMin: 40 };
const promoFlag: ChangeInput = { kind: 'flag', id: 'flag-promo-banner', at: at(2, 4), flag: 'storefront.promo-banner', from: false, to: true, author: 'm.santos', messageKey: 'change.promoFlag', jitterMin: 25 };

const background: EffectInput[] = [
  { id: 'gw-settlement-window', component: 'payment-gw', param: 'tail.ratio', op: 'set', value: 0.07, from: at(2, 30), until: at(5, 0), rampMin: 15 },
  { id: 'orders-archive-cron', component: 'payments-db', param: 'cpu', op: 'add', value: 0.24, from: at(3, 20), until: at(3, 34), rampMin: 2, jitterMin: 12 },
];

// A change costs checkout-api a minute of CPU as it lands; sharing the change's id and jitter keeps that minute, and the log that follows it, where the change is.
function landing(change: ChangeInput): EffectInput {
  return { id: change.id, component: 'checkout-api', param: 'cpu', op: 'add', value: 0.03, from: change.at, until: change.at + 1, jitterMin: change.jitterMin ?? 0 };
}

function landingLog(id: 'checkout.config-reload' | 'checkout.deploy-rollout', change: ChangeInput, body: string): LogInput {
  return { id, component: 'checkout-api', severity: 'INFO', body, trigger: { kind: 'rate', perMin: 4, from: change.at, until: change.at + 1, followsEffect: change.id } };
}

const configReload = (change: ChangeInput, version: string) =>
  landingLog('checkout.config-reload', change, `config reloaded: version ${version}, 1 key changed, rollout 100% of instances (no canary stage), checks: schema only, no range validation`);
const deployRollout = (change: ChangeInput, version: string) =>
  landingLog('checkout.deploy-rollout', change, `rollout ${version}: 4/4 instances updated in one step (no canary stage), checks: unit tests + 5-minute smoke test`);

const restart: MitigationInput = { id: 'restart-checkout', costMin: 4, actions: [{ type: 'restart', component: 'checkout-api' }] };
const scale: MitigationInput = { id: 'scale-checkout', costMin: 8, actions: [{ type: 'scale', component: 'checkout-api', instances: 8 }] };
const revert = (change: string): MitigationInput => ({ id: `revert-${change}`, costMin: 5, actions: [{ type: 'revertChange', change }] });
const rollback = (change: string, id: string): MitigationInput => ({ id, costMin: 6, actions: [{ type: 'revertChange', change }] });

const p99 = 'histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket{service="checkout-api"}[5m])))';

// The causes of tonight's variant, and of every other one: each night's real factors are the other nights' distractors.
const factors = {
  a: [
    {
      id: 'timeout-raised', kind: 'trigger', textKey: 'factor.timeoutRaised',
      requiredEvidence: [
        ['change:cfg-413'],
        ['log:checkout.payment-timeout', 'span:checkout-api:payment.authorize:timeout', 'metric:http_client_request_duration_seconds:checkout-api'],
      ],
    },
    { id: 'gw-slow-tail', kind: 'condition', textKey: 'factor.gwSlowTail', requiredEvidence: [['runbook:payment-gw', 'metric:http_client_requests_total:checkout-api']] },
    { id: 'unguarded-config', kind: 'latent', textKey: 'factor.unguardedConfig', requiredEvidence: [['log:checkout.config-reload']] },
  ],
  b: [
    {
      id: 'deploy-regression', kind: 'trigger', textKey: 'variant.b.factor.regression',
      requiredEvidence: [['change:deploy-checkout-2140'], ['log:checkout.slow-request', 'span:checkout-api:POST /orders:ok']],
    },
    { id: 'work-in-request', kind: 'condition', textKey: 'variant.b.factor.inRequest', requiredEvidence: [['metric:http_client_request_duration_seconds:checkout-api', 'span:cart-api:GET /carts/{id}:ok']] },
    { id: 'unguarded-deploy', kind: 'latent', textKey: 'variant.b.factor.unguardedDeploy', requiredEvidence: [['log:checkout.deploy-rollout']] },
  ],
  c: [
    { id: 'stock-check', kind: 'trigger', textKey: 'variant.c.factor.stockCheck', requiredEvidence: [['change:flag-promo-banner'], ['log:checkout.stock-check']] },
    { id: 'cpu-saturated', kind: 'condition', textKey: 'variant.c.factor.cpuSaturated', requiredEvidence: [['metric:process_cpu_utilization_ratio:checkout-api', 'log:checkout.worker-queue']] },
    { id: 'fixed-capacity', kind: 'latent', textKey: 'variant.c.factor.fixedCapacity', requiredEvidence: [['log:checkout.autoscaler']] },
  ],
  d: [
    { id: 'memory-leak', kind: 'trigger', textKey: 'variant.d.factor.leak', requiredEvidence: [['change:deploy-checkout-2130'], ['metric:process_memory_usage_bytes:checkout-api']] },
    { id: 'gc-pauses', kind: 'condition', textKey: 'variant.d.factor.gcPauses', requiredEvidence: [['log:checkout.gc-pause']] },
    { id: 'no-soak', kind: 'latent', textKey: 'variant.d.factor.noSoak', requiredEvidence: [['log:checkout.deploy-rollout']] },
  ],
} satisfies Record<string, FactorInput[]>;

const todaysDistractors = [
  { id: 'db-overloaded', textKey: 'distractor.dbOverloaded' },
  { id: 'cart-deploy', textKey: 'distractor.cartDeploy' },
  { id: 'traffic-spike', textKey: 'distractor.trafficSpike' },
  { id: 'promo-banner', textKey: 'distractor.promoBanner' },
];

function distractors(own: keyof typeof factors) {
  const others = (Object.keys(factors) as (keyof typeof factors)[]).filter((k) => k !== own);
  return [...todaysDistractors, ...others.flatMap((k) => factors[k].map((f) => ({ id: f.id, textKey: f.textKey })))];
}

function chain(nodes: NonNullable<VariantInput['causalChain']>['nodes'], edges: [string, string][]) {
  return { nodes, edges: edges.map(([from, to]) => ({ from, to })) };
}

// A: the timeout pushed during the gateway's settlement window.
const cfg413: ChangeInput = {
  kind: 'config', id: 'cfg-413', at: at(3, 3), component: 'checkout-api', key: 'payment.client.timeout_ms',
  from: 800, to: 8000, version: 'v413', author: 'r.ibarra', ticket: 'CHG-2291', messageKey: 'change.timeout',
};
const deploy2132: ChangeInput = { kind: 'deploy', id: 'deploy-checkout-2132', at: at(0, 25), component: 'checkout-api', version: '2.13.2', author: 'j.paredes', messageKey: 'variant.a.change.deploy', jitterMin: 30 };

const variantA: VariantInput = {
  id: 'a',
  changes: [cartDeploy, promoFlag, deploy2132, cfg413],
  effects: [...background, landing(deploy2132), landing(cfg413)],
  logs: [configReload(cfg413, 'v413'), deployRollout(deploy2132, '2.13.2')],
  mitigations: [revert('cfg-413'), rollback('deploy-checkout-2132', 'rollback-checkout-2132'), restart, scale],
  factors: factors.a,
  distractorFactors: distractors('a'),
  causalChain: chain(
    [
      { id: 'unguarded', kind: 'latent', labelKey: 'chain.unguarded', factor: 'unguarded-config' },
      { id: 'change', kind: 'change', labelKey: 'chain.change', factor: 'timeout-raised' },
      { id: 'settlement', kind: 'condition', labelKey: 'chain.settlement', factor: 'gw-slow-tail' },
      { id: 'waiting', kind: 'condition', labelKey: 'chain.waiting' },
      { id: 'p99', kind: 'symptom', labelKey: 'chain.p99' },
      { id: 'customers', kind: 'impact', labelKey: 'chain.customers' },
    ],
    [['unguarded', 'change'], ['change', 'waiting'], ['settlement', 'waiting'], ['waiting', 'p99'], ['p99', 'customers']],
  ),
  solution: {
    steps: [
      { tool: 'changes' },
      { tool: 'metrics', query: 'histogram_quantile(0.99, sum by (le) (rate(http_client_request_duration_seconds_bucket{service="checkout-api", peer_service="payment-gw"}[5m])))' },
      { tool: 'logs', filter: 'service:checkout-api level:warn+ "timed out"' },
      { tool: 'logs', filter: 'service:checkout-api "config reloaded"' },
      { tool: 'runbook', runbook: 'payment-gw' },
    ],
    mitigation: 'revert-cfg-413',
  },
};

// B: a release that makes every order slow inside checkout-api itself.
const cfg411: ChangeInput = {
  kind: 'config', id: 'cfg-411', at: at(1, 40), component: 'checkout-api', key: 'orders.receipt.template',
  from: 'r6', to: 'r7', version: 'v411', author: 'r.ibarra', ticket: 'CHG-2288', messageKey: 'variant.b.change.config', jitterMin: 30,
};
const deploy2140: ChangeInput = { kind: 'deploy', id: 'deploy-checkout-2140', at: at(2, 58), component: 'checkout-api', version: '2.14.0', author: 'j.paredes', messageKey: 'variant.b.change.deploy' };

const variantB: VariantInput = {
  id: 'b',
  changes: [cartDeploy, promoFlag, cfg411, deploy2140],
  effects: [
    ...background, landing(cfg411), landing(deploy2140),
    { id: 'orders-per-item-latency', component: 'checkout-api', param: 'latency.medianMs', op: 'add', value: 2000, from: at(2, 58), rampMin: 4, removedBy: ['rollback-checkout-2140'] },
    { id: 'orders-per-item-cpu', component: 'checkout-api', param: 'cpu', op: 'add', value: 0.15, from: at(2, 58), rampMin: 4, removedBy: ['rollback-checkout-2140'] },
  ],
  logs: [configReload(cfg411, 'v411'), deployRollout(deploy2140, '2.14.0')],
  mitigations: [revert('cfg-411'), rollback('deploy-checkout-2140', 'rollback-checkout-2140'), restart, scale],
  factors: factors.b,
  distractorFactors: distractors('b'),
  causalChain: chain(
    [
      { id: 'unguarded', kind: 'latent', labelKey: 'variant.b.chain.unguarded', factor: 'unguarded-deploy' },
      { id: 'change', kind: 'change', labelKey: 'variant.b.chain.change', factor: 'deploy-regression' },
      { id: 'in-request', kind: 'condition', labelKey: 'variant.b.chain.inRequest', factor: 'work-in-request' },
      { id: 'self-time', kind: 'condition', labelKey: 'variant.b.chain.selfTime' },
      { id: 'p99', kind: 'symptom', labelKey: 'chain.p99' },
      { id: 'customers', kind: 'impact', labelKey: 'variant.b.chain.customers' },
    ],
    [['unguarded', 'change'], ['change', 'self-time'], ['in-request', 'self-time'], ['self-time', 'p99'], ['p99', 'customers']],
  ),
  solution: {
    steps: [
      { tool: 'changes' },
      { tool: 'metrics', query: p99 },
      { tool: 'metrics', query: 'histogram_quantile(0.99, sum by (le) (rate(http_client_request_duration_seconds_bucket{service="checkout-api"}[5m])))' },
      { tool: 'logs', filter: 'service:checkout-api "slow request"' },
      { tool: 'logs', filter: 'service:checkout-api "rollout" since:1h' },
    ],
    mitigation: 'rollback-checkout-2140',
  },
  debriefNoteKey: 'variant.b.debriefNote',
};

// C: the promo flag adds a stock check per order and four instances run out of CPU.
const cfg412: ChangeInput = {
  kind: 'config', id: 'cfg-412', at: at(0, 50), component: 'checkout-api', key: 'orders.export.batch_size',
  from: 500, to: 1000, version: 'v412', author: 'r.ibarra', ticket: 'CHG-2289', messageKey: 'variant.c.change.config', jitterMin: 30,
};
const deploy2141: ChangeInput = { kind: 'deploy', id: 'deploy-checkout-2141', at: at(1, 30), component: 'checkout-api', version: '2.14.1', author: 'j.paredes', messageKey: 'variant.c.change.deploy', jitterMin: 30 };
const stockFlag: ChangeInput = { ...promoFlag, at: at(2, 56), jitterMin: 0 };
const saturated = { from: at(2, 56), rampMin: 3, removedBy: ['scale-checkout'] };

const variantC: VariantInput = {
  id: 'c',
  changes: [cartDeploy, stockFlag, cfg412, deploy2141],
  effects: [
    ...background, landing(cfg412), landing(deploy2141),
    { id: 'promo-stock-check', component: 'checkout-api', param: 'cpu', op: 'add', value: 0.42, from: at(2, 56), rampMin: 3 },
    { id: 'cpu-saturation', component: 'checkout-api', param: 'cpu', op: 'add', value: 0.5, ...saturated },
    { id: 'cpu-queue-latency', component: 'checkout-api', param: 'latency.medianMs', op: 'add', value: 500, ...saturated },
    { id: 'cpu-queue-tail', component: 'checkout-api', param: 'tail.ratio', op: 'set', value: 0.06, ...saturated },
    { id: 'cpu-queue-tail-ms', component: 'checkout-api', param: 'tail.medianMs', op: 'set', value: 5000, ...saturated },
  ],
  logs: [
    configReload(cfg412, 'v412'), deployRollout(deploy2141, '2.14.1'),
    { id: 'checkout.stock-check', component: 'checkout-api', severity: 'INFO', body: 'promo stock check: {int:3-9} stock lookups for order ord_{hex:6}', trigger: { kind: 'rate', perMin: 6, followsEffect: 'promo-stock-check' } },
    { id: 'checkout.worker-queue', component: 'checkout-api', severity: 'WARN', body: 'all 16 workers busy, {int:4-31} requests queued (cpu throttled)', trigger: { kind: 'rate', perMin: 2, followsEffect: 'cpu-saturation' } },
  ],
  mitigations: [revert('cfg-412'), rollback('deploy-checkout-2141', 'rollback-checkout-2141'), restart, scale],
  factors: factors.c,
  distractorFactors: distractors('c'),
  causalChain: chain(
    [
      { id: 'fixed', kind: 'latent', labelKey: 'variant.c.chain.fixed', factor: 'fixed-capacity' },
      { id: 'change', kind: 'change', labelKey: 'variant.c.chain.change', factor: 'stock-check' },
      { id: 'cpu', kind: 'condition', labelKey: 'variant.c.chain.cpu', factor: 'cpu-saturated' },
      { id: 'queue', kind: 'condition', labelKey: 'variant.c.chain.queue' },
      { id: 'p99', kind: 'symptom', labelKey: 'chain.p99' },
      { id: 'customers', kind: 'impact', labelKey: 'variant.c.chain.customers' },
    ],
    [['change', 'cpu'], ['fixed', 'cpu'], ['cpu', 'queue'], ['queue', 'p99'], ['p99', 'customers']],
  ),
  solution: {
    steps: [
      { tool: 'changes' },
      { tool: 'metrics', query: 'max by (service) (process_cpu_utilization_ratio{service="checkout-api"})' },
      { tool: 'logs', filter: 'service:checkout-api "stock check"' },
      { tool: 'logs', filter: 'service:checkout-api "autoscaler" since:1h' },
    ],
    mitigation: 'scale-checkout',
  },
  debriefNoteKey: 'variant.c.debriefNote',
};

// D: a release from the evening leaks memory; a restart buys minutes, the rollback ends it.
const cfg414: ChangeInput = {
  kind: 'config', id: 'cfg-414', at: at(1, 20), component: 'checkout-api', key: 'payment.client.idempotency_ttl_s',
  from: 3600, to: 7200, version: 'v414', author: 'r.ibarra', ticket: 'CHG-2290', messageKey: 'variant.d.change.config', jitterMin: 30,
};
const deploy2130: ChangeInput = { kind: 'deploy', id: 'deploy-checkout-2130', at: at(-1, 20), component: 'checkout-api', version: '2.13.0', author: 'j.paredes', messageKey: 'variant.d.change.deploy' };
const leaking = { resetBy: ['restart-checkout'], removedBy: ['rollback-checkout-2130'] };

const variantD: VariantInput = {
  id: 'd',
  changes: [cartDeploy, promoFlag, cfg414, deploy2130],
  effects: [
    ...background, landing(cfg414), landing(deploy2130),
    { id: 'heap-growth', component: 'checkout-api', param: 'memoryMb', op: 'add', value: 0, growthPerMin: 9, from: at(-1, 20), ...leaking },
    // GC starts to stall requests late in the night, and again soon after a restart.
    { id: 'gc-stalls', component: 'checkout-api', param: 'latency.medianMs', op: 'add', value: 0, growthPerMin: 100, from: at(2, 45), ...leaking },
  ],
  logs: [
    configReload(cfg414, 'v414'), deployRollout(deploy2130, '2.13.0'),
    { id: 'checkout.gc-pause', component: 'checkout-api', severity: 'WARN', body: 'GC pause {int:300-1400}ms (old generation), requests stalled', trigger: { kind: 'rate', perMin: 3, followsEffect: 'gc-stalls' } },
  ],
  mitigations: [revert('cfg-414'), rollback('deploy-checkout-2130', 'rollback-checkout-2130'), restart, scale],
  factors: factors.d,
  distractorFactors: distractors('d'),
  causalChain: chain(
    [
      { id: 'no-soak', kind: 'latent', labelKey: 'variant.d.chain.noSoak', factor: 'no-soak' },
      { id: 'change', kind: 'change', labelKey: 'variant.d.chain.change', factor: 'memory-leak' },
      { id: 'heap', kind: 'condition', labelKey: 'variant.d.chain.heap' },
      { id: 'gc', kind: 'condition', labelKey: 'variant.d.chain.gc', factor: 'gc-pauses' },
      { id: 'p99', kind: 'symptom', labelKey: 'chain.p99' },
      { id: 'customers', kind: 'impact', labelKey: 'variant.d.chain.customers' },
    ],
    [['no-soak', 'change'], ['change', 'heap'], ['heap', 'gc'], ['gc', 'p99'], ['p99', 'customers']],
  ),
  solution: {
    steps: [
      { tool: 'changes' },
      { tool: 'metrics', query: 'max by (service) (process_memory_usage_bytes{service="checkout-api"})' },
      { tool: 'logs', filter: 'service:checkout-api "GC pause"' },
      { tool: 'logs', filter: 'service:checkout-api "rollout" since:6h' },
    ],
    mitigation: 'rollback-checkout-2130',
  },
  debriefNoteKey: 'variant.d.debriefNote',
};

export const case01: CaseInput = {
  id: 'case-01',
  version: 1,
  order: 1,
  date: '2026-03-12',
  historyFrom: at(-2, 0),
  budgetMin: 90,
  dawn: { beginsAt: at(5, 50), sunriseAt: at(6, 40) },
  traffic: { entry: 'storefront', peakRps: 14, troughRps: 4, peakHour: 20, wobble: 0.08 },
  components: [
    {
      id: 'storefront', kind: 'service', instances: 3, operation: 'POST /checkout',
      latency: { medianMs: 30, sigma: 0.3 }, cpu: { base: 0.06, perRps: 0.012 }, memoryMb: 512,
      calls: [{ id: 'storefront.checkout', to: 'checkout-api', operation: 'POST /orders', timeoutMs: 15000, maxAttempts: 1 }],
    },
    {
      id: 'checkout-api', kind: 'service', instances: 4, operation: 'POST /orders',
      latency: { medianMs: 38, sigma: 0.35 }, cpu: { base: 0.08, perRps: 0.03 }, memoryMb: 768,
      calls: [
        { id: 'checkout.cart', to: 'cart-api', operation: 'GET /carts/{id}', timeoutMs: 500, maxAttempts: 1 },
        {
          id: 'checkout.payment', to: 'payment-gw', operation: 'payment.authorize', timeoutMs: 800, maxAttempts: 2,
          configKeys: { timeoutMs: 'payment.client.timeout_ms', maxAttempts: 'payment.client.max_attempts' },
        },
        { id: 'checkout.db', to: 'payments-db', operation: 'INSERT payments', timeoutMs: 1000, maxAttempts: 1 },
      ],
    },
    {
      id: 'cart-api', kind: 'service', instances: 2, operation: 'GET /carts/{id}',
      latency: { medianMs: 14, sigma: 0.3 }, cpu: { base: 0.05, perRps: 0.01 }, memoryMb: 384,
      calls: [{ id: 'cart.cache', to: 'cart-cache', operation: 'GET cart:*', timeoutMs: 50, maxAttempts: 1 }],
    },
    { id: 'cart-cache', kind: 'cache', operation: 'GET', latency: { medianMs: 1.1, sigma: 0.3 }, cpu: { base: 0.04, perRps: 0.004 }, memoryMb: 2048 },
    { id: 'payments-db', kind: 'database', operation: 'INSERT', latency: { medianMs: 6, sigma: 0.4 }, cpu: { base: 0.22, perRps: 0.01 }, memoryMb: 8192 },
    {
      id: 'payment-gw', kind: 'external', instrumented: false, operation: 'authorize',
      latency: { medianMs: 180, sigma: 0.3 }, tail: { ratio: 0.004, medianMs: 9500, sigma: 0.2 },
      cpu: { base: 0, perRps: 0 }, memoryMb: 1,
    },
  ],
  config: {
    'checkout-api': {
      'payment.client.timeout_ms': 800, 'payment.client.max_attempts': 2, 'payment.client.idempotency_ttl_s': 3600,
      'orders.receipt.template': 'r6', 'orders.export.batch_size': 500,
    },
  },
  logs: [
    {
      id: 'checkout.payment-timeout', component: 'checkout-api', severity: 'WARN',
      body: 'payment.authorize timed out after {elapsedMs}ms (timeout={timeoutMs}ms) attempt={attempt}/{maxAttempts} peer={peer}',
      trigger: { kind: 'attemptTimeout', call: 'checkout.payment' },
    },
    {
      id: 'checkout.payment-retry', component: 'checkout-api', severity: 'INFO',
      body: 'retrying payment.authorize attempt={attempt}/{maxAttempts} order={orderId}',
      trigger: { kind: 'retry', call: 'checkout.payment' },
    },
    {
      id: 'checkout.slow-request', component: 'checkout-api', severity: 'WARN',
      body: 'slow request POST /orders took {durationMs}ms order={orderId}',
      trigger: { kind: 'slowRequest', thresholdMs: 4000 },
    },
    {
      id: 'checkout.failed', component: 'checkout-api', severity: 'ERROR',
      body: 'POST /orders failed: payment not authorized order={orderId}',
      trigger: { kind: 'serverError' },
    },
    { id: 'storefront.health', component: 'storefront', severity: 'DEBUG', body: 'GET /healthz 200 in {int:1-4}ms', trigger: { kind: 'rate', perMin: 6 } },
    { id: 'cart.cache-ratio', component: 'cart-api', severity: 'INFO', body: 'cart cache hit ratio {int:93-97}% over last 60s', trigger: { kind: 'rate', perMin: 1 } },
    { id: 'cache.evictions', component: 'cart-cache', severity: 'WARN', body: 'evicted {int:120-480} keys (maxmemory-policy allkeys-lru)', trigger: { kind: 'rate', perMin: 0.4 } },
    { id: 'db.archive-batch', component: 'payments-db', severity: 'INFO', body: 'orders-archive: moved {int:9000-14000} rows to orders_archive', trigger: { kind: 'rate', perMin: 2, from: at(3, 20), until: at(3, 34), followsEffect: 'orders-archive-cron' } },
    { id: 'db.slow-query', component: 'payments-db', severity: 'WARN', body: 'slow query {int:240-520}ms: INSERT INTO orders_archive SELECT ... WHERE created_at < now() - interval 90 day', trigger: { kind: 'rate', perMin: 1.5, from: at(3, 20), until: at(3, 34), followsEffect: 'orders-archive-cron' } },
    { id: 'checkout.autoscaler', component: 'checkout-api', severity: 'INFO', body: 'autoscaler: checkout-api at 4/4 instances (min=4, max=4), scaling policy disabled', trigger: { kind: 'rate', perMin: 0.2 } },
  ],
  alert: {
    id: 'checkout-p99-latency',
    expr: `${p99} > 4`,
    forMin: 10,
    summaryKey: 'alert.summary',
  },
  page: { at: at(3, 14) },
  impact: { slowMs: 4000, uniqueUserRatio: 0.85 },
  tools: {
    costs: { metrics: 2, dashboard: 3, logs: 3, traces: 3, trace: 1, changes: 2, runbook: 2, map: 1, statusUpdate: 3 },
    dashboards: [
      {
        id: 'checkout-overview',
        titleKey: 'dashboard.checkout',
        panels: [
          { titleKey: 'panel.checkoutP99', unit: 'seconds', query: p99 },
          { titleKey: 'panel.checkoutRate', unit: 'rps', query: 'sum by (status_class) (rate(http_server_requests_total{service="checkout-api"}[5m]))' },
          { titleKey: 'panel.paymentOutcomes', unit: 'rps', query: 'sum by (outcome) (rate(http_client_requests_total{service="checkout-api", peer_service="payment-gw"}[5m]))' },
          { titleKey: 'panel.dbCpu', unit: 'ratio', query: 'max by (service) (process_cpu_utilization_ratio{service="payments-db"})' },
        ],
      },
    ],
    runbooks: [
      { id: 'checkout-latency', titleKey: 'runbook.checkoutLatency.title', bodyKey: 'runbook.checkoutLatency.body' },
      { id: 'payment-gw', titleKey: 'runbook.paymentGw.title', bodyKey: 'runbook.paymentGw.body' },
    ],
  },
  stakeholderPrompts: [{ id: 'lucia-0330', at: at(3, 30), fromKey: 'prompt.lucia.from', askKey: 'prompt.lucia.ask' }],
  variants: [variantA, variantB, variantC, variantD],
  readNext: ['sre-book-postmortems', 'red-method', 'how-complex-systems-fail'],
};

export default case01;
