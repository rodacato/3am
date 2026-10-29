import { describe, expect, it } from 'vitest';
import { caseShelf, currentCase, isUnlocked, nextCase } from '../src/ui/progression';

const ids = ['case-01', 'case-02', 'case-03'];
const closed = (runs = 1) => ({ completed: true, runs, bestMitigationMin: 20 });

describe('cases open in order', () => {
  it('a new reader can open only the first case', () => {
    expect(caseShelf(ids, {}).map((e) => e.state)).toEqual(['open', 'locked', 'locked']);
  });

  it('closing a case opens the next one and only that one', () => {
    expect(caseShelf(ids, { 'case-01': closed() }).map((e) => e.state)).toEqual(['closed', 'open', 'locked']);
  });

  it('a case started but not closed does not open the next', () => {
    const started = { 'case-01': { completed: false, runs: 0, bestMitigationMin: null } };
    expect(isUnlocked(ids, started, 'case-02')).toBe(false);
  });

  it('numbers cases by their place in the course', () => {
    expect(caseShelf(ids, {}).map((e) => e.number)).toEqual([1, 2, 3]);
  });
});

describe('the case on the desk', () => {
  it('is the one the reader chose while it is open to them', () => {
    expect(currentCase(ids, { 'case-01': closed() }, 'case-01')).toBe('case-01');
    expect(currentCase(ids, { 'case-01': closed() }, 'case-02')).toBe('case-02');
  });

  it('never a locked one, even if a save names it', () => {
    expect(currentCase(ids, {}, 'case-03')).toBe('case-01');
  });

  it('without a choice, the first case not yet closed', () => {
    expect(currentCase(ids, { 'case-01': closed() }, undefined)).toBe('case-02');
  });

  it('once everything is closed, the last case', () => {
    expect(currentCase(ids, { 'case-01': closed(), 'case-02': closed(), 'case-03': closed() }, undefined)).toBe('case-03');
  });

  it('an unknown case id falls back instead of breaking the load', () => {
    expect(currentCase(ids, {}, 'case-99')).toBe('case-01');
  });
});

describe('the next case', () => {
  it('follows in order and ends after the last', () => {
    expect(nextCase(ids, 'case-01')).toBe('case-02');
    expect(nextCase(ids, 'case-03')).toBeNull();
    expect(nextCase(ids, 'case-99')).toBeNull();
  });
});
