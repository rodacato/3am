import { describe, expect, it } from 'vitest';
import type { MetricsResult } from '../src/engine/tools';
import { metricPin } from '../src/ui/monitor/pins';
import { boardReducer } from '../src/ui/session/board-reducer';

const source = { tool: 'dashboard' as const, queryId: 7, ranAt: 194, costMin: 1 };
const panel = (query: string, ...values: number[][]): MetricsResult => ({
  query,
  evidence: [`metric:${query}`],
  result: { times: [190, 191, 192, 193, 194], series: values.map((v, i) => ({ labels: { s: String(i) }, values: v })) },
}) as unknown as MetricsResult;

describe('metric pins', () => {
  it('keeps both slips when one dashboard run has the same range pinned on two panels', () => {
    const latency = metricPin(panel('histogram_quantile(0.99, x{service="checkout-api"})', [1, 2, 3, 4, 5]), 191, 193, 'seconds', 'p99', source);
    const errors = metricPin(panel('sum(rate(y{status_class="5xx"}[5m]))', [5, 4, 3, 2, 1]), 191, 193, 'rps', '5xx', source);
    let board = boardReducer({ pins: [], hypotheses: [] }, { type: 'pin', pin: latency });
    board = boardReducer(board, { type: 'pin', pin: errors });
    expect(board.pins.map((p) => p.lines[0])).toEqual(['p99', '5xx']);
  });

  it('gives the same panel and range the same id, so pinning twice keeps one slip', () => {
    const p = panel('x', [1, 2, 3, 4, 5]);
    expect(metricPin(p, 191, 193, 'rps', 'x', source).id).toBe(metricPin(p, 191, 193, 'rps', 'x', source).id);
  });

  it('makes ids a CSS attribute selector can hold', () => {
    const { id } = metricPin(panel('sum(rate(y{status_class="5xx"}[5m]))', [1, 2, 3, 4, 5]), 191, 193, 'rps', '5xx', source);
    expect(id).toMatch(/^[\w-]+$/);
  });
});
