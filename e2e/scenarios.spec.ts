import { expect, test, type Page } from '@playwright/test';
import { closeCase, collectErrors, freshStart, mitigate, monitorClock, seedFor, startShift, strings } from './support';

// Nightly: the paths a reader takes besides the happy one. Each says what would be broken if it failed.

const en = strings('en');

async function openRunbooksUntil(page: Page, target: string) {
  await page.getByRole('tab', { name: en.ui('monitor.tab.runbooks') }).click();
  const runbook = page.getByRole('button', { name: new RegExp(en.kase('runbook.paymentGw.title').replace(/[()]/g, '.')) });
  while ((await monitorClock(page)) < target) {
    const before = await monitorClock(page);
    await runbook.click();
    await expect.poll(() => monitorClock(page)).not.toBe(before);
  }
}

test('a wrong mitigation does not close the case, the right one does, and the debrief says what happened', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page, 'en');
  await startShift(page, en);
  await mitigate(page, en, en.kase('mitigation.restart-checkout.title'));
  await expect(page.locator('.watch')).toContainText(en.ui('watch.nothing').split('{')[0] as string, { timeout: 30_000 });
  await expect(page.getByRole('tab', { name: en.ui('monitor.tab.actions') })).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: en.ui('phone.close') })).toHaveCount(0);
  await expect(page.locator('.action', { hasText: en.kase('mitigation.restart-checkout.title') })).toContainText(en.ui('actions.tried'));

  await mitigate(page, en, 'v413');
  await closeCase(page, en);
  await expect(page.locator('.debrief')).toContainText(en.ui('debrief.restartFirst'));
  expect(errors).toEqual([]);
});

test('answering the stakeholder is checked, sent, costs minutes and is remembered in the debrief', async ({ page }) => {
  await freshStart(page, 'en');
  await startShift(page, en);
  await openRunbooksUntil(page, '03:30');
  await page.getByRole('button', { name: en.ui('phone.reply') }).click();
  await page.getByLabel(en.ui('phone.statusLabel')).fill('Checkout is slow for about 7% of payments since 03:03. Rolling back a config change now. Next update at 03:50.');
  await expect(page.locator('.checks li[data-pass="true"]')).toHaveCount(4);
  const before = await monitorClock(page);
  await page.getByRole('button', { name: en.ui('phone.send').replace('{cost}', '3') }).click();
  await expect(page.locator('.phone')).toContainText(en.ui('phone.sent').split('{')[0] as string);
  await expect.poll(() => monitorClock(page)).not.toBe(before);

  await mitigate(page, en, 'v413');
  await closeCase(page, en);
  await expect(page.locator('.path')).toContainText(en.ui('debrief.path.status'));
  await expect(page.locator('.debrief p', { hasText: en.kase('prompt.lucia.from') })).toHaveCount(0);
});

test('traces: search, open the slowest, tear a span; a receipt reopens it for free', async ({ page }) => {
  await freshStart(page, 'en');
  await startShift(page, en);
  await page.getByRole('tab', { name: en.ui('monitor.tab.traces') }).click();
  await page.getByRole('button', { name: new RegExp(en.ui('monitor.search')) }).click();
  await page.locator('.trace-row').first().click();
  const span = page.locator('.span-row', { hasText: 'payment' }).first();
  await span.hover();
  await span.getByRole('button', { name: en.ui('monitor.tear') }).click();
  await expect(page.locator('.slip')).toHaveCount(1);

  const clock = await monitorClock(page);
  await page.getByRole('tab', { name: en.ui('monitor.tab.logs') }).click();
  await page.locator('.receipt').first().click();
  await expect(page.getByRole('tab', { name: en.ui('monitor.tab.traces') })).toHaveAttribute('aria-selected', 'true');
  expect(await monitorClock(page)).toBe(clock);
  await expect(page.locator('.receipt')).toHaveCount(2);
});

test('metrics: an error fraction is drawn as a percentage and a dragged range becomes evidence', async ({ page }) => {
  await freshStart(page, 'en');
  await startShift(page, en);
  await page.getByRole('tab', { name: en.ui('monitor.tab.metrics') }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('sum(rate(http_server_requests_total{service="checkout-api",status_class="5xx"}[5m])) / sum(rate(http_server_requests_total{service="checkout-api"}[5m]))');
  await page.getByRole('button', { name: new RegExp(en.ui('monitor.run')) }).click();
  const over = page.locator('.u-over').first();
  await expect(over).toBeVisible();
  const box = await over.boundingBox();
  if (!box) throw new Error('chart has no box');
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.slip')).toHaveCount(1);
  await expect(page.locator('.slip')).toContainText('%');
  await expect(page.locator('.slip')).not.toContainText('/s');
});

test('taking a slip down never leaves a selection pointing at it', async ({ page }) => {
  await freshStart(page, 'en');
  await startShift(page, en);
  await page.getByRole('tab', { name: en.ui('monitor.tab.changes') }).click();
  await page.getByRole('button', { name: new RegExp(en.ui('changes.pull').split(' · ')[0] as string) }).click();
  const tears = page.locator('.change').getByRole('button', { name: en.ui('monitor.tear') });
  await tears.nth(0).click();
  await tears.nth(1).click();
  const slips = page.locator('.slip');
  await expect(slips.nth(1)).toHaveAttribute('aria-pressed', 'true');

  await slips.nth(0).getByRole('button', { name: en.ui('board.unpin') }).click();
  await expect(slips).toHaveCount(1);
  await expect(slips.first(), 'the selected slip stays selected').toHaveAttribute('aria-pressed', 'true');

  await slips.first().getByRole('button', { name: en.ui('board.unpin') }).click();
  await expect(slips).toHaveCount(0);
  await expect(page.locator('.glass__hint'), 'no tie hint for a slip that is gone').toHaveCount(0);
});

test('a runbook page can be torn off and the language can change mid-case without losing the night', async ({ page }) => {
  await freshStart(page, 'en');
  await startShift(page, en);
  await page.getByRole('tab', { name: en.ui('monitor.tab.runbooks') }).click();
  await page.getByRole('button', { name: new RegExp(en.kase('runbook.paymentGw.title').replace(/[()]/g, '.')) }).click();
  await page.locator('.runbook').getByRole('button', { name: en.ui('monitor.tear') }).click();
  await expect(page.locator('.slip')).toHaveCount(1);
  const clock = await monitorClock(page);

  const es = strings('es-MX');
  await page.locator('.sill').getByRole('button', { name: 'Español' }).click();
  await expect(page.getByRole('tab', { name: es.ui('monitor.tab.runbooks') })).toBeVisible();
  expect(await monitorClock(page)).toBe(clock);
  await expect(page.locator('.slip')).toHaveCount(1);
});

for (const seed of [seedFor('a', 1), seedFor('a', 2)]) {
  test(`the rollback closes the case on another night (seed ${seed})`, async ({ page }) => {
    const errors = collectErrors(page);
    await freshStart(page, 'en', { seed });
    await startShift(page, en);
    await mitigate(page, en, 'v413');
    await closeCase(page, en);
    await expect(page.locator('.stat').first()).toContainText('′');
    expect(errors).toEqual([]);
  });
}

test('replaying from the debrief starts a fresh night and remembers the closed one', async ({ page }) => {
  await freshStart(page, 'en');
  await startShift(page, en);
  await mitigate(page, en, 'v413');
  await closeCase(page, en);
  await page.getByRole('button', { name: en.ui('debrief.replay') }).click();
  await expect(page.getByText(en.ui('folder.closedBefore.one'))).toBeVisible();
  await startShift(page, en);
  await expect(page.locator('.receipt')).toHaveCount(0);
  await expect(page.locator('.slip')).toHaveCount(0);
});

test('erasing everything returns to an empty first night', async ({ page }) => {
  await freshStart(page, 'en');
  await startShift(page, en);
  await page.getByRole('tab', { name: en.ui('monitor.tab.changes') }).click();
  await page.getByRole('button', { name: new RegExp(en.ui('changes.pull')) }).click();
  await page.locator('.sill').getByRole('button', { name: en.ui('prefs.reset') }).click();
  await page.getByRole('button', { name: en.ui('reset.confirm') }).click();
  await expect(page.getByRole('heading', { name: en.kase('title') })).toBeVisible();
  await expect(page.getByText(en.ui('folder.closedBefore.one'))).toHaveCount(0);
  await startShift(page, en);
  await expect(page.locator('.receipt')).toHaveCount(0);
});

test('a narrow window gets an explanation instead of a crushed monitor', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await freshStart(page, 'en');
  await expect(page.getByText(en.ui('app.narrow'))).toBeVisible();
});
