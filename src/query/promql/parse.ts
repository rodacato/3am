import type { SyntaxNode } from '@lezer/common';
import { parser } from '@prometheus-io/lezer-promql';
import { parseDurationMinutes } from '../../engine/time';
import type { AggregateOp, BinaryOp, Expr, FunctionName, MatchOp, Matcher, VectorSelector } from './ast';
import { PromQLError } from './errors';

const FUNCTIONS: readonly FunctionName[] = ['rate', 'increase', 'histogram_quantile'];
const AGGREGATIONS: readonly AggregateOp[] = ['sum', 'avg', 'min', 'max', 'count'];
const OPERATOR_NODES: Record<string, BinaryOp> = {
  Add: '+', Sub: '-', Mul: '*', Div: '/', Mod: '%', Pow: '^',
  Eql: '==', Neq: '!=', Gtr: '>', Lss: '<', Gte: '>=', Lte: '<=',
};
const MODIFIER_NODES = new Set(['BoolModifier', 'MatchingModifierClause', 'FillModifier']);
const UNSUPPORTED_NODES: Record<string, string> = {
  OffsetExpr: 'offset', SubqueryExpr: 'subquery', StepInvariantExpr: '@', AnchoredExpr: 'anchored', SmoothedExpr: 'smoothed',
  StringLiteral: 'string literal', And: 'and', Or: 'or', Unless: 'unless', Atan2: 'atan2', QuotedLabelMatcher: 'quoted label matcher',
};

function children(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

function unquote(raw: string, at: number): string {
  if (raw.startsWith('`')) return raw.slice(1, -1);
  try {
    if (raw.startsWith("'")) return JSON.parse(`"${raw.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`) as string;
    return JSON.parse(raw) as string;
  } catch {
    throw new PromQLError('syntax', raw, at);
  }
}

export function parsePromQL(query: string): Expr {
  if (!query.trim()) throw new PromQLError('empty_query', '', 0);
  const tree = parser.parse(query);
  tree.iterate({
    enter(n) {
      if (n.type.isError) throw new PromQLError('syntax', query.slice(Math.max(0, n.from - 12), n.from + 12), n.from);
    },
  });
  const text = (n: SyntaxNode) => query.slice(n.from, n.to);
  const top = tree.topNode.firstChild;
  if (!top) throw new PromQLError('empty_query', '', 0);

  const selector = (node: SyntaxNode): VectorSelector => {
    const matchers: Matcher[] = [];
    for (const child of children(node)) {
      if (child.name === 'Identifier') matchers.push({ name: '__name__', op: '=', value: text(child) });
      if (child.name !== 'LabelMatchers') continue;
      for (const m of children(child)) {
        if (m.name !== 'UnquotedLabelMatcher') throw new PromQLError('unsupported_feature', UNSUPPORTED_NODES[m.name] ?? m.name, m.from);
        const name = m.getChild('LabelName');
        const op = m.getChild('MatchOp');
        const value = m.getChild('StringLiteral');
        if (!name || !op || !value) throw new PromQLError('syntax', text(m), m.from);
        matchers.push({ name: text(name), op: text(op) as MatchOp, value: unquote(text(value), value.from) });
      }
    }
    return { type: 'vector', matchers };
  };

  const convert = (node: SyntaxNode): Expr => {
    const unsupported = UNSUPPORTED_NODES[node.name];
    if (unsupported) throw new PromQLError('unsupported_feature', unsupported, node.from);
    switch (node.name) {
      case 'ParenExpr': {
        const inner = children(node)[0];
        if (!inner) throw new PromQLError('syntax', text(node), node.from);
        return convert(inner);
      }
      case 'NumberDurationLiteral': {
        const value = Number(text(node));
        if (Number.isNaN(value) && !/^[+-]?(nan|inf)$/i.test(text(node))) throw new PromQLError('unsupported_feature', text(node), node.from);
        return { type: 'number', value: /inf/i.test(text(node)) ? (text(node).startsWith('-') ? -Infinity : Infinity) : value };
      }
      case 'VectorSelector':
        return selector(node);
      case 'MatrixSelector': {
        const vector = node.getChild('VectorSelector');
        const range = node.getChild('NumberDurationLiteralInDurationContext');
        if (!vector || !range) throw new PromQLError('syntax', text(node), node.from);
        const rangeMin = parseDurationMinutes(text(range));
        if (rangeMin === null || rangeMin < 1 || !Number.isInteger(rangeMin)) throw new PromQLError('unsupported_feature', text(range), range.from);
        return { type: 'matrix', selector: selector(vector), rangeMin };
      }
      case 'FunctionCall': {
        const id = node.getChild('FunctionIdentifier');
        const body = node.getChild('FunctionCallBody');
        const name = id ? text(id) : '';
        if (!(FUNCTIONS as readonly string[]).includes(name)) throw new PromQLError('unsupported_function', name, node.from);
        return { type: 'call', fn: name as FunctionName, args: body ? children(body).map(convert) : [] };
      }
      case 'AggregateExpr': {
        const opNode = node.getChild('AggregateOp');
        const op = opNode ? text(opNode) : '';
        if (!(AGGREGATIONS as readonly string[]).includes(op)) throw new PromQLError('unsupported_aggregation', op, node.from);
        const modifier = node.getChild('AggregateModifier');
        let grouping: { mode: 'by' | 'without'; labels: string[] } | null = null;
        if (modifier) {
          const labels = modifier.getChild('GroupingLabels');
          grouping = {
            mode: modifier.getChild('Without') ? 'without' : 'by',
            labels: labels ? children(labels).filter((c) => c.name === 'LabelName').map(text) : [],
          };
        }
        const body = node.getChild('FunctionCallBody');
        const args = body ? children(body) : [];
        if (args.length !== 1 || !args[0]) throw new PromQLError('syntax', text(node), node.from);
        return { type: 'aggregate', op: op as AggregateOp, grouping, expr: convert(args[0]) };
      }
      case 'BinaryExpr': {
        const parts = children(node);
        const modifier = parts.find((p) => MODIFIER_NODES.has(p.name));
        if (modifier) throw new PromQLError('unsupported_feature', text(modifier), modifier.from);
        const opNode = parts.find((p) => p.name in OPERATOR_NODES || p.name in UNSUPPORTED_NODES);
        const operands = parts.filter((p) => p !== opNode);
        if (!opNode || operands.length !== 2 || !operands[0] || !operands[1]) throw new PromQLError('syntax', text(node), node.from);
        const op = OPERATOR_NODES[opNode.name];
        if (!op) throw new PromQLError('unsupported_feature', text(opNode), opNode.from);
        return { type: 'binary', op, lhs: convert(operands[0]), rhs: convert(operands[1]) };
      }
      case 'UnaryExpr': {
        const opNode = node.getChild('UnaryOp');
        const operand = children(node).find((c) => c.name !== 'UnaryOp');
        if (!operand) throw new PromQLError('syntax', text(node), node.from);
        const inner = convert(operand);
        return opNode && text(opNode) === '-' ? { type: 'negate', expr: inner } : inner;
      }
      default:
        throw new PromQLError('unsupported_feature', node.name, node.from);
    }
  };

  return convert(top);
}
