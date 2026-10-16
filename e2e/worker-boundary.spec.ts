import { expect, test } from '@playwright/test';
import { validateCase } from '../src/engine/case-schema';
import { runTool } from '../src/engine/tools';
import case01 from '../src/content/cases/case-01/case';
import { freshStart, strings } from './support';

// The browser answers through the Web Worker; Node answers directly. They must agree to the line.
test('a log search counts the same lines in the worker as in Node', async ({ page }) => {
  const { ui } = strings('en');
  const filter = 'service:checkout-api level:warn+';
  const data = validateCase(case01);
  const node = runTool({ data, seed: 1, mitigations: [] }, data.page.at, { tool: 'logs', filter });
  if (!node.ok || node.data.tool !== 'logs') throw new Error('node query failed');

  await freshStart(page, 'en');
  await page.getByRole('button', { name: ui('folder.start') }).click();
  await page.getByRole('button', { name: ui('phone.ack') }).click();
  await page.getByRole('tab', { name: ui('monitor.tab.logs') }).click();
  await page.getByLabel(ui('logs.filterLabel')).fill(filter);
  await page.getByRole('button', { name: new RegExp(ui('monitor.search')) }).click();
  const expected = new Intl.NumberFormat('en').format(node.data.total);
  await expect(page.locator('.result-head').first()).toContainText(`${expected} lines`);
  const firstBody = node.data.records[0]?.body ?? '';
  await expect(page.locator('.log-row').first()).toContainText(firstBody.slice(0, 40));
});

test('reduced motion keeps the whole case playable', async ({ page }) => {
  const { ui } = strings('en');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await freshStart(page, 'en');
  await page.getByRole('button', { name: ui('folder.start') }).click();
  await page.getByRole('button', { name: ui('phone.ack') }).click();
  await page.getByRole('tab', { name: ui('monitor.tab.actions') }).click();
  await page.locator('.action', { hasText: 'v413' }).getByRole('button').click();
  await page.getByRole('button', { name: ui('actions.go'), exact: true }).click();
  await expect(page.getByRole('button', { name: ui('phone.close') })).toBeVisible({ timeout: 15_000 });
});
