import { expect, test } from '@playwright/test';
import { closeCase, collectErrors, expectDebriefOf, expectResolved, freshStart, mitigate, seedFor, startShift, strings, type Variant } from './support';

// Each night of case 01 has its own cause and its own fix; the right action must close it and the debrief must tell that night's story.

const en = strings('en');

const nights: { variant: Variant; fix: string }[] = [
  { variant: 'b', fix: 'mitigation.rollback-checkout-2140.title' },
  { variant: 'c', fix: 'mitigation.scale-checkout.title' },
  { variant: 'd', fix: 'mitigation.rollback-checkout-2130.title' },
];

for (const { variant, fix } of nights) {
  test(`variant ${variant} closes with its own fix and debriefs its own chain`, async ({ page }) => {
    const errors = collectErrors(page);
    await freshStart(page, 'en', { seed: seedFor(variant) });
    await startShift(page, en);
    await mitigate(page, en, en.kase(fix));
    await expectResolved(page, en);
    await closeCase(page, en);
    await expectDebriefOf(page, en, variant);
    expect(errors).toEqual([]);
  });
}

test('variant d: a restart does not resolve the case, the rollback does', async ({ page }) => {
  const errors = collectErrors(page);
  await freshStart(page, 'en', { seed: seedFor('d') });
  await startShift(page, en);
  await mitigate(page, en, en.kase('mitigation.restart-checkout.title'));
  await expect(page.locator('.watch')).toContainText(en.ui('watch.nothing').split('{')[0] as string, { timeout: 30_000 });
  await expect(page.getByRole('tab', { name: en.ui('monitor.tab.actions') })).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: en.ui('phone.close') })).toHaveCount(0);

  await mitigate(page, en, en.kase('mitigation.rollback-checkout-2130.title'));
  await expectResolved(page, en);
  await closeCase(page, en);
  await expectDebriefOf(page, en, 'd');
  expect(errors).toEqual([]);
});
