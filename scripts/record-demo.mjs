// Records the README demo against a running build: node scripts/record-demo.mjs <url> <outDir>
import { chromium } from '@playwright/test';

const [url = 'http://localhost:5318/', outDir = 'test-results/demo'] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: outDir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
const pause = (ms) => page.waitForTimeout(ms);
const button = (name, exact = false) => page.getByRole('button', { name, exact }).first();

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.evaluate(() => document.fonts.ready);
await button('Start the shift').click();
await pause(2600);
await button('ACKNOWLEDGE').click();
await pause(1600);

await page.getByRole('tab', { name: 'CHANGES' }).click();
await button('PULL THE CHANGE LOG').click();
await pause(900);
await page.locator('.change', { hasText: 'v413' }).getByRole('button').click();
await pause(700);

await page.getByRole('tab', { name: 'LOGS' }).click();
await page.getByLabel('Log filter').fill('');
await page.getByLabel('Log filter').pressSequentially('service:checkout-api level:warn+ "timed out"', { delay: 18 });
await button('SEARCH').click();
await page.waitForSelector('.log-row');
await pause(700);
await page.locator('.log-row').first().hover();
await page.locator('.log-row').first().getByRole('button').click();
await pause(500);

await page.getByRole('tab', { name: 'RUNBOOKS' }).click();
await button('payment-gw (external provider)').click();
await page.waitForSelector('.runbook');
await pause(900);
await page.locator('.runbook').getByRole('button').click();

await page.getByRole('tab', { name: 'METRICS' }).click();
await page.locator('.cm-content').click();
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type('max by (service) (process_cpu_utilization_ratio{service="payments-db"})', { delay: 8 });
await button('RUN').click();
await page.waitForSelector('.chart canvas');
await pause(500);
const box = await page.locator('.chart').first().boundingBox();
await page.mouse.move(box.x + box.width * 0.6, box.y + 60);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.92, box.y + 60, { steps: 12 });
await page.mouse.up();
await pause(600);

const hypothesis = async (text, accuses) => {
  await button('+ HYPOTHESIS').click();
  const card = page.locator('.hypothesis').last();
  await card.locator('textarea').pressSequentially(text, { delay: 22 });
  await card.locator('select').selectOption(accuses);
  await card.getByRole('button', { name: 'pin it' }).click();
  await pause(500);
};
await page.locator('.glass').click({ position: { x: 700, y: 20 } });
await pause(900);
await hypothesis('Retries pile up since the 03:03 config push.', 'checkout-api');
await hypothesis('payments-db is overloaded.', 'payments-db');
const tie = async (slip, hyp) => {
  await page.locator('.slip').nth(slip).click();
  await pause(250);
  await page.locator('.hypothesis').nth(hyp).click({ position: { x: 120, y: 60 } });
  await pause(650);
};
await tie(0, 0);
await tie(1, 0);
await tie(2, 0);
await tie(3, 1);
await pause(1200);
await page.locator('.hypothesis').nth(1).getByRole('button', { name: 'alibi', exact: true }).click();
await pause(1600);
await page.locator('.hypothesis').nth(0).getByRole('button', { name: 'holds', exact: true }).click();
await pause(2600);

await page.getByRole('tab', { name: 'ACTIONS' }).click();
await pause(800);
await page.locator('.action', { hasText: 'v413' }).getByRole('button').click();
await button('GO', true).click();
await pause(8200);

await button('CLOSE THE CASE').click();
await pause(600);
const sheet = page.locator('.sheet');
await button('Copy my night').click();
for (const text of ['payment client timeout', 'settlement window', 'no canary']) {
  await sheet.locator('.factor-card', { hasText: text }).click();
  await pause(250);
}
await pause(700);
await button('READ IT BACK').click();
await pause(600);
await button('FILE IT').click();
await pause(5200);

await ctx.close();
console.log(await page.video().path());
await browser.close();
