import { expect, test } from '@playwright/test';
import { freshStart, LOCALES, startShift, strings } from './support';

const ZONES = ['monitor', 'phone', 'monitor', 'monitor', 'window', 'window', 'monitor'];
const STEPS = ['clock', 'phone', 'monitor', 'receipts', 'evidence', 'hypotheses', 'close'];

for (const locale of LOCALES) {
  test(`the walkthrough lights each zone it explains (${locale})`, async ({ page }) => {
    const { ui, kase } = strings(locale);
    await freshStart(page, locale, { tour: 'auto' });
    for (const [i, step] of STEPS.entries()) {
      const dialog = page.getByRole('dialog', { name: ui(`tour.${step}.title`) });
      await expect(dialog).toBeVisible();
      await expect(dialog).not.toContainText('{');
      await expect(page.locator('.room')).toHaveAttribute('data-focus', ZONES[i] as string);
      await dialog.getByRole('button', { name: i === STEPS.length - 1 ? ui('tour.done') : ui('tour.next') }).click();
    }
    await expect(page.getByRole('heading', { name: kase('title') })).toBeVisible();
  });
}

test('the walkthrough answers to the keyboard', async ({ page }) => {
  const { ui } = strings('en');
  await freshStart(page, 'en', { tour: 'auto' });
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: ui('tour.phone.title') })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: ui('tour.clock.title') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('?tour=on shows it again after it was seen; ?tour=off never shows it', async ({ page }) => {
  const { ui, kase } = strings('en');
  await freshStart(page, 'en', { tour: 'auto' });
  await page.getByRole('button', { name: ui('tour.skip') }).click();
  await page.goto('./?tour=on');
  await expect(page.getByRole('dialog', { name: ui('tour.clock.title') })).toBeVisible();

  await page.evaluate(() => localStorage.clear());
  await page.goto('./?tour=off');
  await expect(page.getByRole('heading', { name: kase('title') })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('reopening it mid-case costs no minutes', async ({ page }) => {
  const s = strings('en');
  await freshStart(page, 'en');
  await startShift(page, s);
  await page.getByRole('tab', { name: s.ui('monitor.tab.changes') }).click();
  await page.getByRole('button', { name: new RegExp(s.ui('changes.pull')) }).click();
  await expect(page.locator('.monitor__clock')).toContainText('03:16');
  await page.locator('.sill').getByRole('button', { name: s.ui('prefs.tour') }).click();
  await expect(page.getByRole('dialog', { name: s.ui('tour.clock.title') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.monitor__clock')).toContainText('03:16');
  await expect(page.locator('.receipt')).toHaveCount(1);
  await expect(page.locator('.room')).toHaveAttribute('data-focus', 'monitor');
});
