import { useMemo, useState } from 'react';
import { SOURCES } from '../../content/sources';
import { reportMethod } from '../../engine/scoring';
import { clockLabel } from '../../engine/time';
import { useI18n } from '../../i18n/i18n';
import type { Session } from '../session/useCaseSession';
import { CausalChain } from './CausalChain';

type Props = { session: Session; reducedMotion: boolean; onReplay: () => void; onReset: () => void };

export function Debrief({ session, reducedMotion, onReplay, onReset }: Props) {
  const { t, format } = useI18n();
  const { data, seed, context, board, postmortem } = session;
  const report = useMemo(() => reportMethod(data, seed, context, board, postmortem), [data, seed, context, board, postmortem]);
  const named = new Set(report.factorsNamed.matched);
  const covered = report.coverage.filter((c) => c.covered).length;
  const [exporting, setExporting] = useState(false);

  const takeHome = async () => {
    setExporting(true);
    try {
      const files = await session.exportIncident();
      for (const [signal, payload] of Object.entries(files)) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `3am-${data.id}-seed${seed}-${signal}.otlp.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } finally {
      setExporting(false);
    }
  };

  const path = [
    { at: data.page.at, text: t('debrief.path.paged'), kind: 'event', useful: false },
    { at: context.ackAt ?? data.page.at, text: t('debrief.path.ack'), kind: 'event', useful: false },
    ...report.queries.map((q) => {
      const entry = context.queries.find((e) => e.id === q.id);
      return { at: q.ranAt, text: `Q-${String(q.id).padStart(2, '0')} ${t(`tool.${q.tool}`)} −${q.costMin}′ ${q.useful ? '' : `· ${t('debrief.detour')}`}`, kind: 'query', useful: q.useful, detail: entry?.request.tool === 'metrics' ? entry.request.query : entry?.request.tool === 'logs' || entry?.request.tool === 'traces' ? entry.request.filter : undefined };
    }),
    ...context.mitigations.map((m) => ({ at: m.startedAt, text: t(`case.mitigation.${m.id}.title`), kind: 'mitigation', useful: m.id === data.solution.mitigation })),
    ...(context.stableAt !== null ? [{ at: context.stableAt, text: t('debrief.path.stable'), kind: 'event', useful: true }] : []),
  ].sort((a, b) => a.at - b.at);

  return (
    <div className="overlay">
      <article className="sheet debrief" aria-labelledby="debrief-title">
        <div className="kicker">{t('debrief.kicker')}</div>
        <h1 id="debrief-title">{t('debrief.title')}</h1>
        <div className="stat-row">
          <div className="stat"><strong>{report.timeToMitigateMin === null ? '—' : `${report.timeToMitigateMin}′`}</strong><span>{t('debrief.stat.mitigate')}</span></div>
          <div className="stat"><strong>{format(report.usersAffected)}</strong><span>{t('debrief.stat.users')}</span></div>
          <div className="stat"><strong>{report.detourMin}′</strong><span>{t('debrief.stat.detours')}</span></div>
          <div className="stat"><strong>{covered}/{report.coverage.length}</strong><span>{t('debrief.stat.evidence')}</span></div>
          <div className="stat"><strong>{report.hypotheses.confirmed}/{report.hypotheses.refuted}</strong><span>{t('debrief.stat.hypotheses')}</span></div>
        </div>
        <h2>{t('debrief.chain')}</h2>
        <CausalChain data={data} named={named} reducedMotion={reducedMotion} />
        <div className="debrief-grid">
          <section>
            <p className="muted" style={{ fontSize: 14.5 }}>{t('case.debrief.chainNote')}</p>
            <h2>{t('debrief.why')}</h2>
            <p>{t('debrief.contributing')}</p>
          </section>
          <section>
            <h2>{t('debrief.yourPath')}</h2>
            <ol className="path">
              {path.map((p, i) => (
                <li key={i} data-useful={p.useful} data-kind={p.kind}>
                  {clockLabel(p.at)} · {p.text}
                  {'detail' in p && p.detail && <><br /><em>{p.detail.slice(0, 90)}</em></>}
                </li>
              ))}
            </ol>
            {report.restartedBeforeLooking && <p>{t('debrief.restartFirst')}</p>}
            {report.factorsNamed.distractors.length > 0 && <p>{t('debrief.distractors', { count: report.factorsNamed.distractors.length })}</p>}
            {report.factorsNamed.missed.length > 0 && <p>{t('debrief.missed', { count: report.factorsNamed.missed.length })}</p>}
          </section>
        </div>
        <h2>{t('debrief.readNext')}</h2>
        <ul>
          {data.readNext.map((id) => {
            const s = SOURCES.find((x) => x.id === id);
            if (!s) return null;
            return (
              <li key={id}>
                <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{s.title}</a> <span className="muted">— {s.authors}, {s.year}.</span> {t(`source.${id}.note`)}
              </li>
            );
          })}
        </ul>
        <div className="row" style={{ marginTop: 22, justifyContent: 'space-between' }}>
          <button className="big-button big-button--ghost" onClick={onReset}>{t('debrief.reset')}</button>
          <span className="row">
            <button className="big-button big-button--ghost" onClick={() => void takeHome()} disabled={exporting} title={t('debrief.takeHomeHint')}>
              {exporting ? t('debrief.packing') : t('debrief.takeHome')}
            </button>
            <button className="big-button" onClick={onReplay}>{t('debrief.replay')}</button>
          </span>
        </div>
      </article>
    </div>
  );
}
