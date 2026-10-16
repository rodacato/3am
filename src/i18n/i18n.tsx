import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

export type Messages = Record<string, string>;
export type Params = Record<string, string | number>;

const files = import.meta.glob<{ default: Messages }>('./locales/*.json', { eager: true });

export const MESSAGES: Record<string, Messages> = Object.fromEntries(
  Object.entries(files).map(([path, mod]) => [path.replace('./locales/', '').replace('.json', ''), mod.default]),
);

export const SOURCE_LOCALE = 'en';

export const LOCALES = Object.entries(MESSAGES)
  .map(([code, m]) => ({ code, name: m['meta.name'] ?? code, short: m['meta.short'] ?? code }))
  .sort((a, b) => (a.code === SOURCE_LOCALE ? -1 : b.code === SOURCE_LOCALE ? 1 : a.code.localeCompare(b.code)));

export function detectLocale(preferred: readonly string[]): string {
  const codes = LOCALES.map((l) => l.code);
  for (const wanted of preferred) {
    const exact = codes.find((c) => c.toLowerCase() === wanted.toLowerCase());
    if (exact) return exact;
    const sameLanguage = codes.find((c) => c.split('-')[0] === wanted.split('-')[0]);
    if (sameLanguage) return sameLanguage;
  }
  return SOURCE_LOCALE;
}

export function interpolate(text: string, params?: Params, locale = SOURCE_LOCALE): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value;
  });
}

export function translate(locale: string, extra: Messages, key: string, params?: Params): string {
  const tables = [extra, MESSAGES[locale] ?? {}, MESSAGES[SOURCE_LOCALE] ?? {}];
  const count = params?.count;
  if (typeof count === 'number') {
    const plural = `${key}.${new Intl.PluralRules(locale).select(count)}`;
    for (const table of tables) if (table[plural] !== undefined) return interpolate(table[plural] as string, params, locale);
  }
  for (const table of tables) if (table[key] !== undefined) return interpolate(table[key] as string, params, locale);
  return key;
}

export type Translate = (key: string, params?: Params) => string;

type I18nValue = { locale: string; t: Translate; has: (key: string) => boolean; format: (n: number) => string };

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, caseMessages, children }: { locale: string; caseMessages: Messages; children: ReactNode }) {
  const extra = useMemo(() => Object.fromEntries(Object.entries(caseMessages).map(([k, v]) => [`case.${k}`, v])), [caseMessages]);
  const t = useCallback<Translate>((key, params) => translate(locale, extra, key, params), [locale, extra]);
  const value = useMemo<I18nValue>(() => ({
    locale,
    t,
    has: (key) => extra[key] !== undefined || MESSAGES[locale]?.[key] !== undefined || MESSAGES[SOURCE_LOCALE]?.[key] !== undefined,
    format: (n) => new Intl.NumberFormat(locale).format(n),
  }), [locale, t, extra]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n outside I18nProvider');
  return value;
}
