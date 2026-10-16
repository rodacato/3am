// Codes are translated in the UI; detail carries the raw PromQL token, which stays untranslated.
export type PromQLErrorCode =
  | 'syntax'
  | 'unsupported_function'
  | 'unsupported_aggregation'
  | 'unsupported_feature'
  | 'expected_range'
  | 'expected_instant'
  | 'expected_scalar'
  | 'scalar_comparison'
  | 'bad_regex'
  | 'empty_query';

export class PromQLError extends Error {
  constructor(
    readonly code: PromQLErrorCode,
    readonly detail: string,
    readonly position: number,
  ) {
    super(`${code}: ${detail} at ${position}`);
    this.name = 'PromQLError';
  }
}
