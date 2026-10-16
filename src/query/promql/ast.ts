export type MatchOp = '=' | '!=' | '=~' | '!~';
export type Matcher = { name: string; op: MatchOp; value: string };

export type AggregateOp = 'sum' | 'avg' | 'min' | 'max' | 'count';
export type ArithmeticOp = '+' | '-' | '*' | '/' | '%' | '^';
export type ComparisonOp = '==' | '!=' | '>' | '<' | '>=' | '<=';
export type BinaryOp = ArithmeticOp | ComparisonOp;
export type FunctionName = 'rate' | 'increase' | 'histogram_quantile';

export type VectorSelector = { type: 'vector'; matchers: Matcher[] };

export type Expr =
  | { type: 'number'; value: number }
  | VectorSelector
  | { type: 'matrix'; selector: VectorSelector; rangeMin: number }
  | { type: 'call'; fn: FunctionName; args: Expr[] }
  | { type: 'aggregate'; op: AggregateOp; grouping: { mode: 'by' | 'without'; labels: string[] } | null; expr: Expr }
  | { type: 'binary'; op: BinaryOp; lhs: Expr; rhs: Expr }
  | { type: 'negate'; expr: Expr };

export const COMPARISON_OPS: readonly ComparisonOp[] = ['==', '!=', '>', '<', '>=', '<='];
