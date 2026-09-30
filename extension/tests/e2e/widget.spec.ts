import { expect, test } from '@playwright/test';
import type { IrisDebug } from '../../src/core/debug';

/** The built dist-widget/ on plain fixture pages, with the embed tag. */

test('nothing reaches the backend until the panel opens; window.Iris opens and closes it', async ({
  page,
}) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) calls.push(request.url());
  });
  await page.goto('/widget/checkout.html');
  await page.waitForFunction(() => window.Iris !== undefined);
  // Chips and client checks work straight away, locally.
  await expect(page.locator('iris-overlay')).toBeAttached();
  await page.waitForTimeout(1_500);
  expect(calls).toEqual([]);
  expect(await page.evaluate(() => window.Iris?.isOpen())).toBe(false);
  await page.evaluate(() => {
    window.Iris?.open();
  });
  expect(await page.evaluate(() => window.Iris?.isOpen())).toBe(true);
  await expect.poll(() => calls.some((url) => url.endsWith('/api/pages'))).toBe(true);
  await page.evaluate(() => {
    window.Iris?.close();
  });
  expect(await page.evaluate(() => window.Iris?.isOpen())).toBe(false);
});

test('pill, panel and minimise; fonts and the worklet load from next to the script', async ({
  page,
}) => {
  await page.goto('/widget/terms.html?iris_debug=1&iris_mock_voice=1');
  const widget = page.locator('iris-widget');
  const pill = widget.getByRole('button', { name: 'Talk to Iris' });
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(widget.getByText("Hi, I'm Iris.")).toBeVisible();
  const box = await widget.locator('.iris-widget__panel').boundingBox();
  expect({ width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) }).toEqual({
    width: 380,
    height: 600,
  });
  await widget.getByRole('button', { name: 'Minimise Iris' }).click();
  await expect(pill).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('600 16px IrisInter')))
    .toBe(true);
  const worklet = await page.evaluate(
    async () => (await fetch('/dist-widget/pcm-worklet.js')).status,
  );
  expect(worklet).toBe(200);
});

test('small screens get a bottom sheet, and highlights stay above it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/widget/terms.html?iris_debug=1&iris_mock_voice=1');
  await page.waitForFunction(() => window.Iris !== undefined);
  await page.evaluate(() => {
    window.Iris?.open();
  });
  const sheet = await page.locator('iris-widget .iris-widget__panel').boundingBox();
  expect(sheet?.width).toBe(390);
  expect(sheet?.height).toBeCloseTo(844 * 0.7, 0);
  await page.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
  await page.evaluate(() =>
    (window.IrisDebug as IrisDebug).runTool('ask_page', { question: 'Can I cancel anytime?' }),
  );
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => (window.IrisDebug as IrisDebug).overlayRects())).filter(
          (r) => r.kind === 'marker',
        ).length,
    )
    .toBeGreaterThan(0);
  const markers = (
    await page.evaluate(() => (window.IrisDebug as IrisDebug).overlayRects())
  ).filter((r) => r.kind === 'marker');
  const sheetTop = sheet?.y ?? 0;
  for (const marker of markers)
    expect(marker.rect.y + marker.rect.height).toBeLessThanOrEqual(sheetTop);
});

test('the collapsed pill rises above a fixed bar at the bottom, and returns when it goes', async ({
  page,
}) => {
  await page.goto('/widget/checkout.html?iris_debug=1');
  const pill = page.locator('iris-widget').getByRole('button', { name: 'Talk to Iris' });
  const manage = page.getByRole('button', { name: 'Manage choices' });
  await expect(pill).toBeVisible();
  const bannerTop = (await page.locator('.cookies').boundingBox())?.y ?? 0;
  await expect
    .poll(async () => {
      const box = await pill.boundingBox();
      return (box?.y ?? 0) + (box?.height ?? 0);
    })
    .toBeLessThanOrEqual(bannerTop);
  await manage.click({ trial: true });
  await page.getByRole('button', { name: 'Accept all' }).click();
  await expect
    .poll(async () => (await pill.boundingBox())?.y ?? 0, { timeout: 5_000 })
    .toBeGreaterThan(bannerTop);
});
