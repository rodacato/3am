import type { QueryLogEntry } from '../../engine/incident-machine';
import { clockLabel } from '../../engine/time';
import { useI18n } from '../../i18n/i18n';

const VISIBLE = 7;

function summary(entry: QueryLogEntry, t: (k: string) => string): string {
  const r = entry.request;
  switch (r.tool) {
    case 'metrics': return r.query;
    case 'logs': return r.filter;
    case 'traces': return r.filter;
    case 'trace': return `trace ${r.ref}`;
    case 'dashboard': return r.dashboard;
    case 'runbook': return r.runbook;
    case 'changes': return t('tray.changelog');
    case 'map': return '';
  }
}

export function PrintTray({ queries, current, onReopen }: { queries: QueryLogEntry[]; current: number | null; onReopen: (id: number) => void }) {
  const { t } = useI18n();
  const recent = [...queries].reverse().slice(0, VISIBLE);
  return (
    <aside className="tray" aria-label={t('tray.label')}>
      <div className="tray__label">{t('tray.label')} · {queries.length}</div>
      {recent.length === 0 && <div className="hint" style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 12.5 }}>{t('tray.empty')}</div>}
      {recent.map((q) => (
        <button key={q.id} className="receipt" aria-current={current === q.id} onClick={() => onReopen(q.id)} title={summary(q, t)}>
          <div className="receipt__head">Q-{String(q.id).padStart(2, '0')} · {t(`tool.${q.request.tool}`).toUpperCase()}</div>
          <div className="receipt__head">{clockLabel(q.ranAt)} · −{q.costMin} MIN</div>
          <div className="receipt__body">{summary(q, t)}</div>
        </button>
      ))}
    </aside>
  );
}
