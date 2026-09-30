/** The guided walkthrough, with mock voice on the harness terms page. */
import { expect, test, type Page } from '@playwright/test';
import type { IrisDebug } from '../../src/core/debug';

const tour = (page: Page) => page.evaluate(() => (window.IrisDebug as IrisDebug).getState().tour);

async function say(page: Page, text: string) {
  const box = page.locator('iris-widget').getByPlaceholder('Or type a question…');
  await box.fill(text);
  await box.press('Enter');
}

test('walk through the page: start, next, back and stop', async ({ page }) => {
  await page.goto('/pages/terms.html?iris_mock_voice=1&iris_debug=1');
  await page.waitForFunction(() => window.IrisDebug !== undefined);
  await page.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
  const bar = page.locator('iris-widget').getByRole('region', { name: 'Walkthrough' });

  await say(page, 'Walk me through this page');
  await expect(bar).toContainText('Step 1 of');
  const first = await tour(page);
  expect(first?.step).toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window.IrisDebug as IrisDebug).getState().highlight_ids))
    .toEqual([first?.key]);

  await say(page, 'next');
  await expect.poll(async () => (await tour(page))?.step).toBe(2);
  await say(page, 'next');
  await expect.poll(async () => (await tour(page))?.step).toBe(3);
  await bar.getByRole('button', { name: 'Back' }).click();
  await expect.poll(async () => (await tour(page))?.step).toBe(2);
  await expect(bar).toContainText(`Step 2 of ${String(first?.total)}`);

  await bar.getByRole('button', { name: 'Stop' }).click();
  await expect(bar).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window.IrisDebug as IrisDebug).getState().highlight_ids))
    .toEqual([]);
});

test('guide me in filling this form: part by part, following my clicks', async ({ page }) => {
  await page.goto('/pages/form.html?iris_mock_voice=1&iris_debug=1');
  await page.waitForFunction(() => window.IrisDebug !== undefined);
  await page.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
  await page.evaluate(() => (window.IrisDebug as IrisDebug).startSession());
  const bar = page.locator('iris-widget').getByRole('region', { name: 'Walkthrough' });

  await say(page, 'Can you guide me in filling this form?');
  await expect(bar).toContainText('Your details');
  const first = await tour(page);
  expect(first).toMatchObject({ step: 1, mode: 'form' });
  // The whole part is highlighted: several fields at once.
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => (window.IrisDebug as IrisDebug).getState().highlight_ids))
          .length,
    )
    .toBeGreaterThan(1);

  // Clicking into a field of the next part moves the walkthrough there.
  await page.locator('#ifsc').click();
  await expect(bar).toContainText('Bank and security');
  expect((await tour(page))?.step).toBe(2);
  await expect
    .poll(() => page.evaluate(() => (window.IrisDebug as IrisDebug).getState().spoken.join(' ')))
    .toContain('Bank and security');
});
