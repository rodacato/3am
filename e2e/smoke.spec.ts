import { expect, test } from '@playwright/test';
import { collectErrors, freshStart, LOCALES, startShift, strings } from './support';

// Runs on every pull request: fast, and fails on anything that would stop a reader in the first minute.
test.describe('smoke', { tag: '@smoke' }, () => {
  for (const locale of LOCALES) {
    test(`boots, takes the page and runs a query (${locale})`, async ({ page }) => {
      const s = strings(locale);
      const errors = collectErrors(page);
      await freshStart(page, locale);
      await expect(page.getByRole('heading', { name: s.kase('title') })).toBeVisible();
      await startShift(page, s);
      await page.getByRole('button', { name: new RegExp(s.kase('dashboard.checkout')) }).click();
      await expect(page.locator('.monitor__clock')).toContainText('03:17');
      await expect(page.locator('.chart canvas').first()).toBeVisible();
      await expect(page.locator('.receipt')).toHaveCount(1);
      expect(errors).toEqual([]);
    });
  }

  test('progress survives a reload', async ({ page }) => {
    const s = strings('en');
    await freshStart(page, 'en');
    await startShift(page, s);
    await page.getByRole('tab', { name: s.ui('monitor.tab.changes') }).click();
    await page.getByRole('button', { name: new RegExp(s.ui('changes.pull')) }).click();
    await page.locator('.change', { hasText: 'v413' }).getByRole('button', { name: s.ui('monitor.tear') }).click();
    await page.reload();
    await expect(page.locator('.slip')).toHaveCount(1);
    await expect(page.locator('.monitor__clock')).toContainText('03:16');
  });

  test('the walkthrough opens on a first visit and stays closed once seen', async ({ page }) => {
    const { ui, kase } = strings('en');
    await freshStart(page, 'en', { tour: 'auto' });
    await expect(page.getByRole('dialog', { name: ui('tour.clock.title') })).toBeVisible();
    await page.getByRole('button', { name: ui('tour.skip') }).click();
    await expect(page.getByRole('heading', { name: kase('title') })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: kase('title') })).toBeVisible();
    await expect(page.getByRole('dialog', { name: ui('tour.clock.title') })).toHaveCount(0);
  });
});
