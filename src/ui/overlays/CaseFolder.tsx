import { LOCALES, useI18n } from '../../i18n/i18n';
import type { CaseProgress } from '../persistence';
import type { ShelfEntry } from '../progression';

type Props = {
  caseNumber: number;
  shelf: ShelfEntry[];
  onOpenCase: (id: string) => void;
  progress: CaseProgress | undefined;
  locale: string;
  sound: boolean;
  onLocale: (code: string) => void;
  onSound: (on: boolean) => void;
  onStart: () => void;
  onReplay: () => void;
  onTour: () => void;
};

export function CaseFolder({ caseNumber, shelf, onOpenCase, progress, locale, sound, onLocale, onSound, onStart, onReplay, onTour }: Props) {
  const { t } = useI18n();
  return (
    <div className="overlay" style={{ background: 'transparent', alignItems: 'end', paddingBottom: '4vh' }}>
      <article className="sheet folder" aria-labelledby="case-title" style={{ width: 'min(860px, 100%)' }}>
        <span className="folder__tab">{t('folder.tab', { number: String(caseNumber).padStart(2, '0') })}</span>
        <div className="kicker">{t('folder.kicker', { company: t('case.company').toLocaleUpperCase(locale) })}</div>
        <h1 id="case-title">{t('case.title')}</h1>
        <div className="folder-row">
          <div>
            <p>{t('case.briefing.company')}</p>
            <p>{t('case.briefing.role')}</p>
            <p className="muted" style={{ fontStyle: 'italic' }}>{t('case.briefing.tonight')}</p>
          </div>
          <div>
            <h2 style={{ marginTop: 0 }}>{t('folder.howTitle')}</h2>
            <p>{t('folder.how')}</p>
            <p className="muted">{t('folder.honor')}</p>
          </div>
        </div>
        {progress?.completed && <p className="muted">{t('folder.closedBefore', { count: progress.runs, runs: progress.runs })}</p>}
        <div className="row" role="group" aria-label={t('folder.cases')} style={{ marginTop: 14 }}>
          {shelf.map((c) => {
            const number = String(c.number).padStart(2, '0');
            return (
              <button
                key={c.id}
                className="big-button big-button--ghost"
                aria-pressed={c.number === caseNumber}
                disabled={c.state === 'locked'}
                title={c.state === 'locked' ? t('folder.lockedHint', { previous: String(c.number - 1).padStart(2, '0') }) : undefined}
                style={{ fontWeight: c.number === caseNumber ? 700 : 400 }}
                onClick={() => onOpenCase(c.id)}
              >
                {t(`folder.case.${c.state}`, { number })}
              </button>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: 18, justifyContent: 'space-between' }}>
          <div className="row" role="group" aria-label={t('prefs.language')}>
            {LOCALES.map((l) => (
              <button key={l.code} className="big-button big-button--ghost" aria-pressed={locale === l.code} style={{ fontWeight: locale === l.code ? 700 : 400 }} onClick={() => onLocale(l.code)}>
                {l.name}
              </button>
            ))}
            <button className="big-button big-button--ghost" onClick={onTour}>{t('folder.tour')}</button>
            <button className="big-button big-button--ghost" aria-pressed={sound} onClick={() => onSound(!sound)}>{sound ? t('prefs.soundOn') : t('prefs.soundOff')}</button>
          </div>
          <div className="row">
            {progress?.completed && <button className="big-button big-button--ghost" onClick={onReplay}>{t('folder.replay')}</button>}
            <button className="big-button" onClick={onStart} autoFocus>{t('folder.start')}</button>
          </div>
        </div>
      </article>
    </div>
  );
}
