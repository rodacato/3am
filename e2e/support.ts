import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { EMPTY_POSTMORTEM } from '../src/engine/board';

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

type StartOptions = { tour?: 'auto' | 'on' | 'off'; seed?: number };

// Seed storage before any app code runs, once per test, so the app's own first save cannot race it.
export async function freshStart(page: Page, locale: Locale, { tour = 'off', seed }: StartOptions = {}) {
  await page.addInitScript(({ code, seed, postmortem }) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    localStorage.clear();
    const sessions = seed === undefined ? {} : { 'case-01': { seed, machine: null, board: { pins: [], hypotheses: [] }, postmortem, statusDraft: '' } };
    localStorage.setItem('3am', JSON.stringify({ version: 1, preferences: { locale: code, sound: false }, progress: {}, sessions }));
  }, { code: locale, seed, postmortem: EMPTY_POSTMORTEM });
  await page.goto(tour === 'auto' ? './' : `./?tour=${tour}`);
  await page.evaluate(() => document.fonts.ready);
}

// Fails the test on any uncaught error or console error, the cheapest signal that the course broke.
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

type Strings = ReturnType<typeof strings>;

export async function monitorClock(page: Page): Promise<string> {
  const text = (await page.locator('.monitor__clock').textContent()) ?? '';
  return /(\d\d:\d\d)\s*$/.exec(text)?.[1] ?? '';
}

export async function startShift(page: Page, { ui }: Strings) {
  await page.getByRole('button', { name: ui('folder.start') }).click();
  await page.getByRole('button', { name: ui('phone.ack') }).click();
  await expect(page.locator('.monitor__clock')).toContainText('03:14');
}

export async function mitigate(page: Page, { ui }: Strings, action: string) {
  await page.getByRole('tab', { name: ui('monitor.tab.actions') }).click();
  await page.locator('.action', { hasText: action }).getByRole('button').click();
  await page.getByRole('button', { name: ui('actions.go'), exact: true }).click();
  await expect(page.locator('.watch')).toBeVisible();
}

// The shortest honest close: draft the timeline, read the notes, file it.
export async function closeCase(page: Page, { ui }: Strings) {
  await page.getByRole('button', { name: ui('phone.close') }).click({ timeout: 30_000 });
  const sheet = page.locator('.sheet');
  await sheet.getByRole('button', { name: ui('pm.draftTimeline') }).click();
  await sheet.getByRole('button', { name: ui('pm.review') }).click();
  await sheet.getByRole('button', { name: ui('pm.file') }).click();
  await expect(page.getByRole('heading', { name: ui('debrief.title') })).toBeVisible();
}
