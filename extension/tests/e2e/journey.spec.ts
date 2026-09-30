/**
 * The journey in a tab: the widget's session carries on to the next page
 * of the same site, remembers the page before, speaks up when a price changed, and answers
 * from the earlier page.
 */
import { expect, test, type Page } from '@playwright/test';
import type { IrisDebug } from '../../src/core/debug';

const FLAGS = '?iris_mock_voice=1&iris_debug=1';

const debug = (page: Page) => page.evaluate(() => (window.IrisDebug as IrisDebug).getState());
const journey = (page: Page) => page.evaluate(() => (window.IrisDebug as IrisDebug).journey());

test('a session carries on to the next page and remembers the one before', async ({ page }) => {
  await page.goto(`/pages/cart.html${FLAGS}`);
  await page.waitForFunction(() => window.IrisDebug !== undefined);
  await page.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
  await page.evaluate(() => (window.IrisDebug as IrisDebug).startSession());
  await expect.poll(async () => (await debug(page)).session_state).toBe('listening');
  // A page left within 3 seconds is a bounce, not part of the journey.
  await page.waitForTimeout(3_200);

  await page.locator('#to-checkout').evaluate((link, flags) => {
    (link as HTMLAnchorElement).search = flags;
  }, FLAGS);
  await page.locator('#to-checkout').click();
  await page.waitForURL(/checkout\.html/);
  await page.waitForFunction(() => window.IrisDebug !== undefined);

  // No Talk button pressed on this page: the session came across from the cart.
  await expect.poll(async () => (await debug(page)).session_state).toBe('listening');
  await expect
    .poll(async () => (await journey(page)).pages.map((p) => new URL(p.url).pathname))
    .toEqual(['/pages/cart.html', '/pages/checkout.html']);

  // The backpack cost ₹2,299 in the cart: Iris says so, and rings the new price.
  await expect
    .poll(async () => (await debug(page)).spoken)
    .toContain(
      'Heads up: the travel backpack here is ₹2,499, but the page “Your cart – Sample Shop” said ₹2,299.',
    );
  expect((await debug(page)).highlight_ids.length).toBeGreaterThan(0);

  // Only the cart says how long a gift message can be.
  const answer = await page.evaluate(() =>
    (window.IrisDebug as IrisDebug).runTool('ask_page', {
      question: 'How long can a gift message be?',
    }),
  );
  expect(answer).toMatchObject({
    card: { kind: 'answer', quote: { page_title: 'Your cart – Sample Shop' } },
    highlight_ids: [],
  });
  await expect(page.locator('iris-widget article.iris-card').first()).toContainText(
    'From an earlier page · Your cart – Sample Shop',
  );
});

test('a new tab starts without the journey or the session', async ({ page, context }) => {
  await page.goto(`/pages/cart.html${FLAGS}`);
  await page.waitForFunction(() => window.IrisDebug !== undefined);
  await page.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
  const other = await context.newPage();
  await other.goto(`/pages/checkout.html${FLAGS}`);
  await other.waitForFunction(() => window.IrisDebug !== undefined);
  await other.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
  expect((await journey(other)).pages).toHaveLength(1);
  expect((await debug(other)).session_state).toBe('idle');
});
