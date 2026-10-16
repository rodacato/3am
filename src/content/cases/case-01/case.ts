import type { CaseInput } from '../../../engine/case-schema';

const at = (hh: number, mm: number) => hh * 60 + mm;

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
  config: { 'checkout-api': { 'payment.client.timeout_ms': 800, 'payment.client.max_attempts': 2 } },
  changes: [
    { kind: 'deploy', id: 'deploy-cart-381', at: at(1, 12), component: 'cart-api', version: '3.8.1', author: 'ci-bot', messageKey: 'change.deployCart' },
    { kind: 'flag', id: 'flag-promo-banner', at: at(2, 4), flag: 'storefront.promo-banner', from: false, to: true, author: 'm.santos', messageKey: 'change.promoFlag' },
    {
      kind: 'config', id: 'cfg-413', at: at(3, 3), component: 'checkout-api', key: 'payment.client.timeout_ms',
      from: 800, to: 8000, version: 'v413', author: 'r.ibarra', ticket: 'CHG-2291', messageKey: 'change.timeout',
    },
  ],
  effects: [
    { id: 'gw-settlement-window', component: 'payment-gw', param: 'tail.ratio', op: 'set', value: 0.07, from: at(2, 30), until: at(5, 0), rampMin: 15 },
    { id: 'orders-archive-cron', component: 'payments-db', param: 'cpu', op: 'add', value: 0.24, from: at(3, 20), until: at(3, 34), rampMin: 2 },
  ],
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
    { id: 'checkout.config-reload', component: 'checkout-api', severity: 'INFO', body: 'config reloaded: version v413, 1 key changed, rollout 100% of instances', trigger: { kind: 'rate', perMin: 4, from: at(3, 3), until: at(3, 4) } },
    { id: 'storefront.health', component: 'storefront', severity: 'DEBUG', body: 'GET /healthz 200 in {int:1-4}ms', trigger: { kind: 'rate', perMin: 6 } },
    { id: 'cart.cache-ratio', component: 'cart-api', severity: 'INFO', body: 'cart cache hit ratio {int:93-97}% over last 60s', trigger: { kind: 'rate', perMin: 1 } },
    { id: 'cache.evictions', component: 'cart-cache', severity: 'WARN', body: 'evicted {int:120-480} keys (maxmemory-policy allkeys-lru)', trigger: { kind: 'rate', perMin: 0.4 } },
    { id: 'db.archive-batch', component: 'payments-db', severity: 'INFO', body: 'orders-archive: moved {int:9000-14000} rows to orders_archive', trigger: { kind: 'rate', perMin: 2, from: at(3, 20), until: at(3, 34) } },
    { id: 'db.slow-query', component: 'payments-db', severity: 'WARN', body: 'slow query {int:240-520}ms: INSERT INTO orders_archive SELECT ... WHERE created_at < now() - interval 90 day', trigger: { kind: 'rate', perMin: 1.5, from: at(3, 20), until: at(3, 34) } },
  ],
  alert: {
    id: 'checkout-p99-latency',
    expr: 'histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket{service="checkout-api"}[5m]))) > 4',
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
          { titleKey: 'panel.checkoutP99', unit: 'seconds', query: 'histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket{service="checkout-api"}[5m])))' },
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
  mitigations: [
    { id: 'revert-cfg-413', costMin: 5, actions: [{ type: 'revertChange', change: 'cfg-413' }] },
    { id: 'restart-checkout', costMin: 4, actions: [{ type: 'restart', component: 'checkout-api' }] },
    { id: 'scale-checkout', costMin: 8, actions: [{ type: 'scale', component: 'checkout-api', instances: 8 }] },
  ],
  stakeholderPrompts: [{ id: 'lucia-0330', at: at(3, 30), fromKey: 'prompt.lucia.from', askKey: 'prompt.lucia.ask' }],
  factors: [
    {
      id: 'timeout-raised', kind: 'trigger', textKey: 'factor.timeoutRaised',
      requiredEvidence: [
        ['change:cfg-413'],
        ['log:checkout.payment-timeout', 'span:checkout-api:payment.authorize:timeout', 'metric:http_client_request_duration_seconds:checkout-api'],
      ],
    },
    { id: 'gw-slow-tail', kind: 'condition', textKey: 'factor.gwSlowTail', requiredEvidence: [['runbook:payment-gw', 'metric:http_client_requests_total:checkout-api']] },
    { id: 'unguarded-config', kind: 'latent', textKey: 'factor.unguardedConfig', requiredEvidence: [['change:cfg-413', 'log:checkout.config-reload']] },
  ],
  distractorFactors: [
    { id: 'db-overloaded', textKey: 'distractor.dbOverloaded' },
    { id: 'cart-deploy', textKey: 'distractor.cartDeploy' },
    { id: 'traffic-spike', textKey: 'distractor.trafficSpike' },
    { id: 'promo-banner', textKey: 'distractor.promoBanner' },
  ],
  causalChain: {
    nodes: [
      { id: 'unguarded', kind: 'latent', labelKey: 'chain.unguarded', factor: 'unguarded-config' },
      { id: 'change', kind: 'change', labelKey: 'chain.change', factor: 'timeout-raised' },
      { id: 'settlement', kind: 'condition', labelKey: 'chain.settlement', factor: 'gw-slow-tail' },
      { id: 'waiting', kind: 'condition', labelKey: 'chain.waiting' },
      { id: 'p99', kind: 'symptom', labelKey: 'chain.p99' },
      { id: 'customers', kind: 'impact', labelKey: 'chain.customers' },
    ],
    edges: [
      { from: 'unguarded', to: 'change' },
      { from: 'change', to: 'waiting' },
      { from: 'settlement', to: 'waiting' },
      { from: 'waiting', to: 'p99' },
      { from: 'p99', to: 'customers' },
    ],
  },
  solution: {
    steps: [
      { tool: 'changes' },
      { tool: 'metrics', query: 'histogram_quantile(0.99, sum by (le) (rate(http_client_request_duration_seconds_bucket{service="checkout-api", peer_service="payment-gw"}[5m])))' },
      { tool: 'logs', filter: 'service:checkout-api level:warn+ "timed out"' },
      { tool: 'runbook', runbook: 'payment-gw' },
    ],
    mitigation: 'revert-cfg-413',
  },
  readNext: ['sre-book-postmortems', 'red-method', 'how-complex-systems-fail'],
};

export default case01;
