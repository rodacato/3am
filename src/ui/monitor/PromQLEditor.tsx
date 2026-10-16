import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { HighlightStyle, LRLanguage, LanguageSupport, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { styleTags, tags } from '@lezer/highlight';
import { parser } from '@prometheus-io/lezer-promql';
import { useEffect, useRef } from 'react';
import type { MetricVocabulary } from '../../telemetry/source';
import { useLatest } from '../useLatest';

const promql = LRLanguage.define({
  name: 'promql',
  parser: parser.configure({
    props: [
      styleTags({
        'FunctionIdentifier/...': tags.function(tags.variableName),
        'AggregateOp/...': tags.keyword,
        'By Without': tags.modifier,
        Identifier: tags.typeName,
        LabelName: tags.propertyName,
        StringLiteral: tags.string,
        'NumberDurationLiteral NumberDurationLiteralInDurationContext': tags.number,
        'MatchOp/... Add Sub Mul Div Mod Pow Eql Neq Gtr Lss Gte Lte': tags.operator,
      }),
    ],
  }),
});

const highlight = HighlightStyle.define([
  { tag: tags.function(tags.variableName), color: '#F2A541' },
  { tag: tags.keyword, color: '#F2A541' },
  { tag: tags.modifier, color: '#C9C3B6' },
  { tag: tags.typeName, color: '#E8E2D6' },
  { tag: tags.propertyName, color: '#8F98A3' },
  { tag: tags.string, color: '#C9B48A' },
  { tag: tags.number, color: '#C9B48A' },
  { tag: tags.operator, color: '#6B7480' },
]);

const FUNCTIONS = [
  { label: 'rate', detail: 'rate(v[5m])' },
  { label: 'increase', detail: 'increase(v[5m])' },
  { label: 'histogram_quantile', detail: 'histogram_quantile(0.99, …)' },
  { label: 'sum', detail: 'sum by (label) (…)' },
  { label: 'avg', detail: 'avg by (label) (…)' },
  { label: 'max', detail: 'max by (label) (…)' },
  { label: 'min', detail: 'min by (label) (…)' },
  { label: 'count', detail: 'count(…)' },
];

// Metric names everywhere; inside {…} label names, and after a matcher operator the values seen in the case.
function completions(vocabulary: MetricVocabulary) {
  return (context: CompletionContext): CompletionResult | null => {
    const tree = syntaxTree(context.state);
    const node = tree.resolveInner(context.pos, -1);
    const text = context.state.doc.toString();
    const inMatchers = node.name === 'LabelMatchers' || node.parent?.name === 'LabelMatchers' || node.parent?.parent?.name === 'LabelMatchers';
    if (inMatchers) {
      const selector = text.slice(0, context.pos).match(/([a-zA-Z_:][\w:]*)\{[^}]*$/);
      const metric = vocabulary.metrics.find((m) => m.name === selector?.[1]);
      const labels = metric?.labels ?? Object.assign({}, ...vocabulary.metrics.map((m) => m.labels));
      const valueMatch = context.matchBefore(/(\w+)\s*(=~|!=|!~|=)\s*"[^"]*/);
      if (valueMatch) {
        const [, label] = /(\w+)\s*(?:=~|!=|!~|=)/.exec(valueMatch.text) ?? [];
        const quote = valueMatch.text.indexOf('"');
        return { from: valueMatch.from + quote + 1, options: ((label && labels[label]) || []).map((v: string) => ({ label: v, type: 'text' })) };
      }
      const word = context.matchBefore(/\w*/);
      if (!word) return null;
      return { from: word.from, options: Object.keys(labels).map((l) => ({ label: l, type: 'property' })) };
    }
    const word = context.matchBefore(/[a-zA-Z_:][\w:]*/);
    if (!word && !context.explicit) return null;
    return {
      from: word?.from ?? context.pos,
      options: [
        ...vocabulary.metrics.map((m) => ({ label: m.name, type: 'variable' })),
        ...FUNCTIONS.map((fn) => ({ ...fn, type: 'function' })),
      ],
    };
  };
}

type Props = { value: string; onChange: (v: string) => void; onRun: () => void; vocabulary: MetricVocabulary | null; placeholder: string; label: string };

export function PromQLEditor({ value, onChange, onRun, vocabulary, placeholder, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useLatest({ onChange, onRun });

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        new LanguageSupport(promql),
        syntaxHighlighting(highlight),
        autocompletion({ override: vocabulary ? [completions(vocabulary)] : [], icons: false }),
        keymap.of([{ key: 'Mod-Enter', run: () => { callbacks.current.onRun(); return true; } }]),
        EditorView.lineWrapping,
        placeholderExt(placeholder),
        EditorView.contentAttributes.of({ 'aria-label': label }),
        EditorView.updateListener.of((u) => { if (u.docChanged) callbacks.current.onChange(u.state.doc.toString()); }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    return () => view.current?.destroy();
    // The editor owns its document; external value changes are pushed in by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vocabulary, placeholder, label]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div className="query-input" ref={host} />;
}
