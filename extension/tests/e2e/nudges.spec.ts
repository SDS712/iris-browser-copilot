import { expect, test } from '@playwright/test';
import type { IrisDebug } from '../../src/core/debug';

const FLAGS = '?iris_mock_voice=1&iris_debug=1';

test('hesitation: 9 s in the CKYC field brings the "Explain" chip; typing removes it', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(`/pages/form.html${FLAGS}`);
  await page.waitForFunction(() => window.IrisDebug !== undefined);
  await page.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
  const chip = page.locator('iris-overlay').getByRole('button', { name: 'Explain' });
  await page.getByLabel('CKYC number (optional)').focus();
  await page.clock.runFor(8_000);
  await expect(chip).toHaveCount(0);
  await page.clock.runFor(1_500);
  await expect(chip).toBeVisible();
  await page.keyboard.type('1');
  await expect(chip).toHaveCount(0);
});

test('Explain chip: opens a session and explains the field from the web', async ({ page }) => {
  await page.clock.install();
  await page.goto(`/pages/form.html${FLAGS}`);
  await page.waitForFunction(() => window.IrisDebug !== undefined);
  await page.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
  await page.getByLabel('CKYC number (optional)').focus();
  await page.clock.runFor(9_500);
  await page.locator('iris-overlay').getByRole('button', { name: 'Explain' }).click();
  await page.clock.runFor(1_000);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.IrisDebug as IrisDebug).getState().cards.map((c) => `${c.kind}:${c.source}`),
      ),
    )
    .toEqual(['field:web']);
  await page.clock.runFor(1_000);
  const state = await page.evaluate(() => (window.IrisDebug as IrisDebug).getState());
  expect(state.session_state).not.toBe('idle');
  expect(state.spoken.join(' ')).toContain('CKYC');
});

test('checkout: a spoken nudge with risk rings when a session starts; the cookie chip rings "Manage choices"', async ({
  page,
}) => {
  await page.goto(`/pages/checkout.html${FLAGS}`);
  await page.waitForFunction(() => window.IrisDebug !== undefined);
  await page.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
  const chip = page.locator('iris-overlay').getByRole('button', { name: 'Show reject option' });
  await expect(chip).toBeVisible();
  await chip.click();
  const kinds = () =>
    page.evaluate(async () =>
      (await (window.IrisDebug as IrisDebug).overlayRects()).map((r) => r.kind),
    );
  await expect.poll(kinds).toEqual(expect.arrayContaining(['ring', 'bubble']));
  await expect(
    page.locator('iris-overlay').getByText("The reject option is inside 'Manage choices'."),
  ).toBeVisible();

  await page.evaluate(() => (window.IrisDebug as IrisDebug).startSession());
  await expect
    .poll(() => page.evaluate(() => (window.IrisDebug as IrisDebug).getState().spoken.join(' ')))
    .toContain('Before you pay');
  await expect.poll(kinds).toContain('risk_ring');
  // The chime came first: mock voice counts it.
  expect(
    await page.evaluate(() => (window.IrisDebug as IrisDebug).getState().cues),
  ).toBeGreaterThanOrEqual(1);
});

test('"stop suggesting" turns nudges off for the session', async ({ page }) => {
  await page.goto(`/pages/checkout.html${FLAGS}`);
  await page.waitForFunction(() => window.IrisDebug !== undefined);
  await page.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
  const panel = page.locator('iris-widget');
  await panel.getByPlaceholder('Or type a question…').fill('Please stop suggesting things');
  await panel.getByPlaceholder('Or type a question…').press('Enter');
  await expect(panel.getByText('Nudges off')).toBeVisible();
  await expect(page.locator('iris-overlay').getByRole('button')).toHaveCount(0);
});
