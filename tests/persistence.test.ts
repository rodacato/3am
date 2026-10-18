import { describe, expect, it } from 'vitest';
import { EMPTY, migrate } from '../src/ui/persistence';

describe('stored progress', () => {
  it('keeps a well-formed save', () => {
    const saved = { ...EMPTY, progress: { 'case-01': { completed: true, runs: 2, bestMitigationMin: 25 } } };
    expect(migrate(saved)).toEqual(saved);
  });

  it.each([
    ['sessions', null],
    ['preferences', null],
    ['progress', 'yes'],
    ['sessions', []],
  ])('replaces a %s of %j with an empty one instead of breaking every load', (key, value) => {
    const stored = migrate({ ...EMPTY, [key]: value });
    expect(stored[key as keyof typeof EMPTY]).toEqual(EMPTY[key as keyof typeof EMPTY]);
  });

  it('drops a case session it could not resume, keeping the others', () => {
    const resumable = { seed: 1, machine: null, board: { pins: [], hypotheses: [] }, postmortem: {}, statusDraft: '' };
    const sessions = { 'case-01': resumable, 'case-02': null, 'case-03': { ...resumable, board: null }, 'case-04': { ...resumable, statusDraft: undefined } };
    expect(Object.keys(migrate({ ...EMPTY, sessions }).sessions)).toEqual(['case-01']);
  });
});
