import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, string>;

export const LOCALES = ['en', 'es-MX'] as const;
export type Locale = (typeof LOCALES)[number];

// Strings come from the locale files, so the tests follow the copy instead of duplicating it.
export function strings(locale: Locale) {
  const ui = read(`src/i18n/locales/${locale}.json`);
  const kase = read(`src/content/cases/case-01/locales/${locale}.json`);
  const get = (table: Record<string, string>, key: string) => {
    const v = table[key];
    if (v === undefined) throw new Error(`missing ${key} in ${locale}`);
    return v;
  };
  return { ui: (k: string) => get(ui, k), kase: (k: string) => get(kase, k) };
}

export async function freshStart(page: Page, locale: Locale) {
  await page.goto('./');
  await page.evaluate((code) => {
    localStorage.clear();
    localStorage.setItem('3am', JSON.stringify({ version: 1, preferences: { locale: code, sound: false }, progress: {}, sessions: {} }));
  }, locale);
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
}
