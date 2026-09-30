import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Every page: no serious or critical axe violations. Iris's own UI is excluded. */

async function serious(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .exclude('iris-widget')
    .exclude('iris-overlay')
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const pages = [
  '/',
  '/demo/',
  '/demo/apply',
  '/demo/terms',
  '/demo/privacy',
  '/demo/checkout',
  '/demo/payment-failed',
  '/demo/not-a-page',
];

for (const path of pages) {
  test(`no serious accessibility problems: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await serious(page)).toEqual([]);
  });
}

test('no serious accessibility problems: checkout review step and the cookie choices', async ({
  page,
}) => {
  await page.goto('/demo/checkout');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Review & pay' })).toBeVisible();
  await page.getByRole('button', { name: 'Manage choices' }).click();
  await expect(page.getByRole('button', { name: 'Reject all' })).toBeVisible();
  expect(await serious(page)).toEqual([]);
});

test('phone width: no serious problems and no sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of pages.slice(0, 7)) {
    await page.goto(path);
    expect(await serious(page), path).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
