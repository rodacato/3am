import { expect, test } from '@playwright/test';
import { closeCase, collectErrors, expectDebriefOf, expectResolved, freshStart, mitigate, seedFor, startShift, strings, type Locale, type Variant } from './support';

// Case 03 opens once case 02 is closed; the cache is loud every night, and guilty on only one of them.

const nights: { variant: Variant; locale: Locale; fix: string }[] = [
  { variant: 'a', locale: 'es-MX', fix: 'mitigation.rollback-bookings-580.title' },
  { variant: 'b', locale: 'en', fix: 'mitigation.revert-cfg-pool-v18.title' },
  { variant: 'c', locale: 'es-MX', fix: 'mitigation.rollback-bookings-582.title' },
  { variant: 'd', locale: 'en', fix: 'mitigation.revert-cfg-cache-v42.title' },
];

for (const { variant, locale, fix } of nights) {
  test(`case 03 variant ${variant} closes with its own fix and debriefs its own chain (${locale})`, async ({ page }) => {
    const s = strings(locale, 'case-03');
    const errors = collectErrors(page);
    await freshStart(page, locale, { caseId: 'case-03', closed: ['case-01', 'case-02'], seed: seedFor(variant) });
    await expect(page.getByRole('heading', { name: s.kase('title') })).toBeVisible();
    await expect(page.locator('.folder__tab')).toContainText('03');
    await startShift(page, s, 'case-03');
    await mitigate(page, s, s.kase(fix));
    await expectResolved(page, s);
    await closeCase(page, s);
    await expectDebriefOf(page, s, variant);
    expect(errors).toEqual([]);
  });
}

test('case 03 variant c: a restart frees the leaked connections for a while and does not resolve the case', async ({ page }) => {
  const s = strings('en', 'case-03');
  const errors = collectErrors(page);
  await freshStart(page, 'en', { caseId: 'case-03', closed: ['case-01', 'case-02'], seed: seedFor('c') });
  await startShift(page, s, 'case-03');
  await mitigate(page, s, s.kase('mitigation.restart-bookings.title'));
  await expect(page.locator('.watch')).toContainText(s.ui('watch.nothing').split('{')[0] as string, { timeout: 30_000 });
  await expect(page.getByRole('tab', { name: s.ui('monitor.tab.actions') })).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: s.ui('phone.close') })).toHaveCount(0);

  await mitigate(page, s, s.kase('mitigation.rollback-bookings-582.title'));
  await expectResolved(page, s);
  await closeCase(page, s);
  await expectDebriefOf(page, s, 'c');
  expect(errors).toEqual([]);
});

test('case 03 is locked until case 02 is closed', async ({ page }) => {
  const two = strings('en', 'case-02');
  const errors = collectErrors(page);
  await freshStart(page, 'en', { caseId: 'case-03', closed: ['case-01'] });
  await expect(page.getByRole('heading', { name: two.kase('title') })).toBeVisible();
  await expect(page.getByRole('button', { name: two.ui('folder.case.locked').replace('{number}', '03') })).toBeDisabled();
  expect(errors).toEqual([]);
});
