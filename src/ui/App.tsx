import { useCallback, useEffect, useMemo, useState } from 'react';
import { CASE_IDS, loadCase, loadCaseMessages } from '../content/registry';
import { EMPTY_POSTMORTEM } from '../engine/board';
import type { CaseData } from '../engine/case-schema';
import { reportMethod } from '../engine/scoring';
import { createStandaloneBridge } from '../host/bridge';
import { detectLocale, I18nProvider, translate, type Messages } from '../i18n/i18n';
import type { MetricVocabulary } from '../telemetry/source';
import { SimulationClient } from '../worker/client';
import { Desk } from './desk/Desk';
import { clearAll, EMPTY, load, save, type CaseSession, type Stored } from './persistence';
import { useCaseSession } from './session/useCaseSession';
import { useReducedMotion } from './useReducedMotion';

const FIRST_SEED = 1;

let client: SimulationClient | null = null;
// One worker for the page's lifetime; StrictMode's double mount must not tear it down.
function sharedClient(): SimulationClient {
  client ??= new SimulationClient();
  return client;
}

function freshSession(seed: number): CaseSession {
  return { seed, machine: null, board: { pins: [], hypotheses: [] }, postmortem: structuredClone(EMPTY_POSTMORTEM), statusDraft: '' };
}

function newSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 7) % 100_000 + 2;
}

type Loaded = { data: CaseData; messages: Messages };

function CaseRoom({ loaded, stored, setStored, client, locale, vocabulary, onReset }: {
  loaded: Loaded; stored: Stored; setStored: (fn: (s: Stored) => Stored) => void; client: SimulationClient; locale: string; vocabulary: MetricVocabulary | null; onReset: () => void;
}) {
  const { data } = loaded;
  const reducedMotion = useReducedMotion();
  const bridge = useMemo(() => createStandaloneBridge(), []);
  const initial = stored.sessions[data.id] ?? freshSession(FIRST_SEED);
  const persist = useCallback((s: CaseSession) => setStored((prev) => ({ ...prev, sessions: { ...prev.sessions, [data.id]: s } })), [data.id, setStored]);
  const session = useCaseSession(data, initial, client, persist);

  return (
    <Desk
      session={session}
      caseNumber={data.order}
      vocabulary={vocabulary}
      progress={stored.progress[data.id]}
      locale={locale}
      sound={stored.preferences.sound}
      reducedMotion={reducedMotion}
      onLocale={(code) => setStored((s) => ({ ...s, preferences: { ...s.preferences, locale: code } }))}
      onSound={(on) => setStored((s) => ({ ...s, preferences: { ...s.preferences, sound: on } }))}
      onReplay={() => setStored((s) => ({ ...s, sessions: { ...s.sessions, [data.id]: freshSession(newSeed()) } }))}
      onReset={() => { clearAll(); setStored(() => structuredClone(EMPTY)); onReset(); }}
      onStarted={() => bridge.unitStarted(data.id)}
      onCompleted={() => {
        const report = reportMethod(data, session.seed, session.context, session.board, session.postmortem);
        bridge.unitCompleted(data.id, { timeToMitigateMin: report.timeToMitigateMin, usersAffected: report.usersAffected, factorsMatched: report.factorsNamed.matched.length, factorsExpected: report.factorsNamed.expected.length });
        setStored((s) => {
          const before = s.progress[data.id];
          const best = [before?.bestMitigationMin, report.timeToMitigateMin].filter((x): x is number => x !== null && x !== undefined);
          return { ...s, progress: { ...s.progress, [data.id]: { completed: true, runs: (before?.runs ?? 0) + 1, bestMitigationMin: best.length ? Math.min(...best) : null } } };
        });
      }}
    />
  );
}

export function App() {
  const [stored, setStoredState] = useState<Stored>(load);
  const client = sharedClient();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [vocabulary, setVocabulary] = useState<MetricVocabulary | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const caseId = CASE_IDS[0] ?? 'case-01';
  const locale = stored.preferences.locale ?? detectLocale(navigator.languages);

  const setStored = useCallback((fn: (s: Stored) => Stored) => {
    setStoredState((prev) => {
      const next = fn(prev);
      save(next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    let live = true;
    Promise.all([loadCase(caseId), loadCaseMessages(caseId, locale)])
      .then(([data, messages]) => { if (live) setLoaded({ data, messages }); })
      .catch((e: unknown) => { if (live) setFailure(e instanceof Error ? e.message : String(e)); });
    client.request({ kind: 'vocabulary', caseId }).then((v) => { if (live) setVocabulary(v); }).catch(() => {});
    return () => { live = false; };
  }, [caseId, locale, client]);

  if (failure) {
    return <div className="loading" role="alert">{translate(locale, {}, 'app.failed')} <br /><small className="mono">{failure}</small></div>;
  }
  if (!loaded) return <div className="loading">{translate(locale, {}, 'app.loading')}</div>;

  const session = stored.sessions[loaded.data.id];
  return (
    <I18nProvider locale={locale} caseMessages={loaded.messages}>
      <CaseRoom key={`${loaded.data.id}#${session?.seed ?? FIRST_SEED}#${epoch}`} loaded={loaded} stored={stored} setStored={setStored} client={client} locale={locale} vocabulary={vocabulary} onReset={() => setEpoch((e) => e + 1)} />
    </I18nProvider>
  );
}
