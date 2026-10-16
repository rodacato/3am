import type { Scenario } from '../engine/state';
import type { Matcher } from '../query/promql/ast';
import type { SeriesSource, SourceSeries } from '../query/promql/evaluate';
import { seriesCatalog, seriesValues } from './metrics';

// The PromQL evaluator sees the simulated case as a Prometheus that has scraped up to `now`.
export function metricSource(s: Scenario, now: number): SeriesSource {
  const catalog = seriesCatalog(s);
  return {
    historyFrom: s.data.historyFrom,
    now,
    select(matchers: readonly Matcher[]): SourceSeries[] {
      const name = matchers.find((m) => m.name === '__name__' && m.op === '=')?.value;
      return catalog
        .filter((def) => !name || def.labels.__name__ === name)
        .map((def) => ({ labels: def.labels, values: (fromMin: number, toMin: number) => seriesValues(s, def, fromMin, toMin) }));
    },
  };
}

export type MetricVocabulary = { metrics: { name: string; labels: Record<string, string[]> }[] };

// Names and label values for editor autocomplete.
export function metricVocabulary(s: Scenario): MetricVocabulary {
  const byName = new Map<string, Map<string, Set<string>>>();
  for (const def of seriesCatalog(s)) {
    const name = def.labels.__name__ as string;
    const labels = byName.get(name) ?? new Map<string, Set<string>>();
    for (const [k, v] of Object.entries(def.labels)) {
      if (k === '__name__') continue;
      const values = labels.get(k) ?? new Set<string>();
      values.add(v);
      labels.set(k, values);
    }
    byName.set(name, labels);
  }
  return {
    metrics: [...byName.entries()].map(([name, labels]) => ({
      name,
      labels: Object.fromEntries([...labels.entries()].map(([k, v]) => [k, [...v].sort()])),
    })),
  };
}
