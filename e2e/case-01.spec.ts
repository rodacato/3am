import { expect, test } from '@playwright/test';
import { freshStart, LOCALES, strings } from './support';

const firstWords = (s: string) => s.split(' · ')[0] as string;

for (const locale of LOCALES) {
  test(`case 01 from page to debrief (${locale})`, async ({ page }) => {
    const { ui, kase } = strings(locale);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await freshStart(page, locale);
    await expect(page.getByRole('heading', { name: kase('title') })).toBeVisible();
    await page.getByRole('button', { name: ui('folder.start') }).click();

    await expect(page.getByText(kase('alert.summary')).first()).toBeVisible();
    await page.getByRole('button', { name: ui('phone.ack') }).click();
    await expect(page.locator('.monitor__clock')).toContainText('03:14');

    // What changed: the change log costs two minutes and the config push can be torn off.
    await page.getByRole('tab', { name: ui('monitor.tab.changes') }).click();
    await page.getByRole('button', { name: new RegExp(firstWords(ui('changes.pull'))) }).click();
    await expect(page.locator('.monitor__clock')).toContainText('03:16');
    await page.locator('.change', { hasText: 'v413' }).getByRole('button', { name: ui('monitor.tear') }).click();
    await expect(page.locator('.slip')).toHaveCount(1);

    // A log line backs it up.
    await page.getByRole('tab', { name: ui('monitor.tab.logs') }).click();
    await page.getByLabel(ui('logs.filterLabel')).fill('service:checkout-api level:warn+ "timed out"');
    await page.getByRole('button', { name: new RegExp(ui('monitor.search')) }).click();
    await page.locator('.log-row').first().hover();
    await page.locator('.log-row').first().getByRole('button').click();
    await expect(page.locator('.slip')).toHaveCount(2);

    // A hypothesis that accuses checkout-api, tied to both slips, and marked as holding.
    await page.getByRole('button', { name: ui('board.newHypothesis') }).click();
    const card = page.locator('.hypothesis').first();
    await card.locator('textarea').fill('timeout raised by the 03:03 config push');
    await card.locator('select').selectOption('checkout-api');
    await card.getByRole('button', { name: ui('board.save') }).click();
    await page.locator('.slip').nth(0).click();
    await card.click({ position: { x: 120, y: 60 } });
    // The second slip is tied with the keyboard alone.
    await page.locator('.slip').nth(1).focus();
    await page.keyboard.press('Enter');
    await card.getByRole('button', { name: ui('board.tieHere') }).press('Enter');
    await expect(card).toContainText(ui('board.pieces.other').replace('{count}', '2'));
    await card.getByRole('button', { name: ui('board.markHolds'), exact: true }).click();
    await expect(card).toHaveAttribute('data-status', 'confirmed');

    // Roll back, watch the line bend, and the phone reports the alert quiet.
    await page.getByRole('tab', { name: ui('monitor.tab.actions') }).click();
    await page.locator('.action', { hasText: 'v413' }).getByRole('button').click();
    await page.getByRole('button', { name: ui('actions.go'), exact: true }).click();
    await expect(page.locator('.watch')).toBeVisible();
    await expect(page.getByRole('button', { name: ui('phone.close') })).toBeVisible({ timeout: 30_000 });

    // Postmortem with the three real factors, then the debrief.
    await page.getByRole('button', { name: ui('phone.close') }).click();
    const sheet = page.locator('.sheet');
    await sheet.getByRole('button', { name: ui('pm.draftTimeline') }).click();
    for (const key of ['factor.timeoutRaised', 'factor.gwSlowTail', 'factor.unguardedConfig']) {
      await sheet.getByRole('button', { name: kase(key) }).click();
    }
    await sheet.getByRole('button', { name: ui('pm.review') }).click();
    await expect(sheet.getByText(ui('rubric.pm.factorsFound.pass').replace('{expected}', '3'))).toBeVisible();
    await sheet.getByRole('button', { name: ui('pm.file') }).click();

    await expect(page.getByRole('heading', { name: ui('debrief.title') })).toBeVisible();
    // The change card and the timeout log back the trigger only; the latent factor needs the config-reload log.
    await expect(page.locator('.stat').nth(3)).toContainText('1/3');
    await expect(page.getByRole('img', { name: ui('debrief.chainLabel') })).toBeVisible();
    // Lucía asked at 03:30 and this run never replied; the debrief says so.
    await expect(page.locator('.debrief p', { hasText: kase('prompt.lucia.from') })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
