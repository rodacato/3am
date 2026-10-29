import { expect, test } from '@playwright/test';
import { closeCase, collectErrors, expectDebriefOf, expectResolved, freshStart, mitigate, seedFor, startShift, strings, type Locale, type Variant } from './support';

// Case 02 opens once case 01 is closed; each of its nights has its own guilty change, never orders-api's deploy.

const nights: { variant: Variant; locale: Locale; fix: string }[] = [
  { variant: 'a', locale: 'en', fix: 'mitigation.rollback-inventory-430.title' },
  { variant: 'b', locale: 'es-MX', fix: 'mitigation.revert-flag-dual-write-v2.title' },
  { variant: 'c', locale: 'en', fix: 'mitigation.revert-cfg-pg-v33.title' },
  { variant: 'd', locale: 'es-MX', fix: 'mitigation.rollforward-inventory-422.title' },
];

for (const { variant, locale, fix } of nights) {
  test(`case 02 variant ${variant} closes with its own fix and debriefs its own chain (${locale})`, async ({ page }) => {
    const s = strings(locale, 'case-02');
    const errors = collectErrors(page);
    await freshStart(page, locale, { caseId: 'case-02', closed: ['case-01'], seed: seedFor(variant) });
    await expect(page.getByRole('heading', { name: s.kase('title') })).toBeVisible();
    await expect(page.locator('.folder__tab')).toContainText('02');
    await startShift(page, s, 'case-02');
    await mitigate(page, s, s.kase(fix));
    await expectResolved(page, s);
    await closeCase(page, s);
    await expectDebriefOf(page, s, variant);
    expect(errors).toEqual([]);
  });
}

test('case 02 is locked until case 01 is closed, then the debrief opens it and it is remembered', async ({ page }) => {
  const one = strings('en');
  const two = strings('en', 'case-02');
  const caseButton = (key: string, number: string) => page.getByRole('button', { name: one.ui(key).replace('{number}', number) });
  const errors = collectErrors(page);

  // A save that names the locked case still opens case 01.
  await freshStart(page, 'en', { caseId: 'case-02' });
  await expect(page.getByRole('heading', { name: one.kase('title') })).toBeVisible();
  await expect(caseButton('folder.case.locked', '02')).toBeDisabled();

  await startShift(page, one);
  await mitigate(page, one, 'v413');
  await closeCase(page, one);
  await caseButton('debrief.next', '02').click();
  await expect(page.getByRole('heading', { name: two.kase('title') })).toBeVisible();
  await expect(page.locator('.folder__tab')).toContainText('02');

  await page.reload();
  await expect(page.getByRole('heading', { name: two.kase('title') })).toBeVisible();

  // The closed case stays open to the reader, right where they left it.
  await caseButton('folder.case.closed', '01').click();
  await expect(page.getByRole('heading', { name: one.ui('debrief.title') })).toBeVisible();
  expect(errors).toEqual([]);
});
