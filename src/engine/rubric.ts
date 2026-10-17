import type { Postmortem } from './board';
import type { CaseData } from './case-schema';

export type RubricItem = { id: string; kind: 'auto' | 'self'; passed: boolean | null; params?: Record<string, string | number> };

// Blame vocabulary comes from the locale files ("a|b|c"), so a new locale brings its own.
export function blameTerms(...lists: string[]): string[] {
  return lists.flatMap((l) => l.split('|')).map((t) => t.trim().toLowerCase()).filter(Boolean);
}

function findIn(text: string, needles: string[]): string | null {
  const lower = text.toLowerCase();
  return needles.find((n) => lower.includes(n.toLowerCase())) ?? null;
}

// Naming who ran a step can be a plain fact; only the reader can tell whether the sentence explains or accuses.
function nameCheck(id: string, text: string, people: string[]): RubricItem[] {
  const name = findIn(text, people);
  return name ? [{ id, kind: 'self', passed: null, params: { name } }] : [];
}

const TIME = /\b([01]?\d|2[0-3]):[0-5]\d\b/;

export function casePeople(data: CaseData): string[] {
  return [...new Set(data.changes.map((c) => c.author).filter((a) => !a.endsWith('-bot')))];
}

export function reviewPostmortem(data: CaseData, pm: Postmortem, terms: string[]): RubricItem[] {
  const expected = data.factors.map((f) => f.id);
  const distractors = new Set(data.distractorFactors.map((d) => d.id));
  const actions = pm.actionItems.filter((a) => a.text.trim());
  const allText = [pm.summary, pm.timeline, pm.impact, pm.customFactor, pm.wentWell, ...actions.map((a) => a.text)].join('\n');
  const blame = findIn(allText, terms);
  const timelineLines = pm.timeline.split('\n').filter((l) => TIME.test(l)).length;
  const matched = pm.factors.filter((f) => expected.includes(f)).length;

  return [
    { id: 'pm.timeline', kind: 'auto', passed: timelineLines >= 3, params: { count: timelineLines } },
    { id: 'pm.impact', kind: 'auto', passed: /\d/.test(pm.impact) },
    { id: 'pm.factorsFound', kind: 'auto', passed: matched === expected.length, params: { matched, expected: expected.length } },
    { id: 'pm.noDistractors', kind: 'auto', passed: !pm.factors.some((f) => distractors.has(f)) },
    { id: 'pm.morethanOne', kind: 'auto', passed: pm.factors.length + (pm.customFactor.trim() ? 1 : 0) >= 2 },
    { id: 'pm.blameless', kind: 'auto', passed: blame === null, params: { term: blame ?? '' } },
    { id: 'pm.actionsTyped', kind: 'auto', passed: actions.length >= 2 && actions.every((a) => a.type !== null && a.owner.trim() !== '') },
    { id: 'pm.actionsPrevent', kind: 'auto', passed: actions.some((a) => a.type === 'prevent' || a.type === 'process') },
    { id: 'pm.wentWell', kind: 'auto', passed: pm.wentWell.trim().length >= 20 },
    { id: 'pm.selfReadable', kind: 'self', passed: null },
    { id: 'pm.selfWhyNotWho', kind: 'self', passed: null },
    ...nameCheck('pm.namesPerson', allText, casePeople(data)),
  ];
}

export function reviewStatusUpdate(text: string, terms: string[], people: string[]): RubricItem[] {
  const blame = findIn(text, terms);
  return [
    { id: 'status.impact', kind: 'auto', passed: /\d/.test(text) },
    { id: 'status.nextUpdate', kind: 'auto', passed: TIME.test(text) || /\b\d+\s?(min|minutes|minutos|h)\b/i.test(text) },
    { id: 'status.length', kind: 'auto', passed: text.trim().length >= 60 && text.trim().length <= 700, params: { length: text.trim().length } },
    { id: 'status.blameless', kind: 'auto', passed: blame === null, params: { term: blame ?? '' } },
    ...nameCheck('status.namesPerson', text, people),
  ];
}
