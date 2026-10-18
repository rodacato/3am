import { describe, expect, it } from 'vitest';
import { FilterError, parseLogFilter, parseTraceFilter } from '../src/query/filters';

const errorOf = (parse: () => unknown) => {
  try {
    parse();
    return 'ok';
  } catch (e) {
    if (e instanceof FilterError) return `${e.code}:${e.detail}`;
    throw e;
  }
};

describe('negation', () => {
  it('excludes a bare word', () => {
    expect(parseLogFilter('timeout -healthz')).toMatchObject({ include: ['timeout'], exclude: ['healthz'] });
  });

  it.each([
    ['-service:checkout-api', () => parseLogFilter('-service:checkout-api')],
    ['-level:error', () => parseLogFilter('-level:error')],
    ['-status:error', () => parseTraceFilter('-status:error')],
  ])('refuses %s instead of applying it un-negated', (input, parse) => {
    expect(errorOf(parse)).toBe(`negated_key:${input}`);
  });
});

describe('empty terms', () => {
  it.each([
    ['foo - bar', '-'],
    ['timeout -', '-'],
    ['service:', 'service:'],
    ['level:warn ""', '""'],
  ])('refuses %s instead of matching nothing', (input, detail) => {
    expect(errorOf(() => parseLogFilter(input))).toBe(`bad_value:${detail}`);
  });

  it('refuses an empty trace operation instead of ignoring it', () => {
    expect(errorOf(() => parseTraceFilter('operation:'))).toBe('bad_value:operation:');
  });
});
