import { expect, test, type Page } from '@playwright/test';
import type { IrisDebug } from '../../src/core/debug';

const FLAGS = '?iris_mock_voice=1&iris_debug=1';

async function open(page: Page, name: string): Promise<void> {
  await page.goto(`/pages/${name}.html${FLAGS}`);
  await page.waitForFunction(() => window.IrisDebug !== undefined);
}

function debug(page: Page) {
  return {
    refresh: () => page.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot()),
    snapshot: () => page.evaluate(() => (window.IrisDebug as IrisDebug).lastSnapshot()),
    runTool: (name: string, args: Record<string, unknown>) =>
      page.evaluate(([n, a]) => (window.IrisDebug as IrisDebug).runTool(n, a), [
        name,
        args,
      ] as const),
    rects: () => page.evaluate(() => (window.IrisDebug as IrisDebug).overlayRects()),
    kinds: async () =>
      (await page.evaluate(() => (window.IrisDebug as IrisDebug).overlayRects())).map(
        (r) => r.kind,
      ),
  };
}

test('terms: ask_page shows an answer card and marks the clause; Esc clears it', async ({
  page,
}) => {
  await open(page, 'terms');
  const iris = debug(page);
  expect(await iris.refresh()).toMatchObject({ page_type: 'terms' });
  const result = await iris.runTool('ask_page', { question: 'Can I cancel anytime?' });
  expect(result).toMatchObject({ card: { kind: 'answer', source: 'page' } });
  await expect(page.locator('iris-widget')).toBeAttached();
  await expect.poll(iris.kinds).toContain('marker');
  const marker = (await iris.rects()).find((r) => r.kind === 'marker');
  expect(marker?.rect.width).toBeGreaterThan(20);
  await page.keyboard.press('Escape');
  await expect.poll(iris.kinds).toEqual([]);
});

test('form: rings, number badges and a bubble render; the page itself is untouched', async ({
  page,
}) => {
  await open(page, 'form');
  const iris = debug(page);
  await iris.refresh();
  const before = await page.evaluate(() => document.body.querySelector('main')?.outerHTML);
  const snapshot = await iris.snapshot();
  const ids = (snapshot?.fields ?? [])
    .filter((f) => ['IFSC', 'CKYC number (optional)'].includes(f.label))
    .map((f) => f.id);
  expect(ids).toHaveLength(2);
  const result = await iris.runTool('highlight_element', {
    element_ids: [...ids, 'i-999'],
    note: 'Fill these two',
  });
  expect(result).toEqual({ ok: true, found: ids, missing: ['i-999'] });
  await expect.poll(iris.kinds).toEqual(expect.arrayContaining(['ring', 'badge', 'bubble']));
  const kinds = await iris.kinds();
  expect(kinds.filter((k) => k === 'ring')).toHaveLength(2);
  expect(kinds.filter((k) => k === 'badge')).toHaveLength(2);
  const overlay = page.locator('iris-overlay');
  await expect(overlay.getByText('Fill these two')).toBeVisible();
  await overlay.getByRole('button', { name: 'Got it' }).click();
  // "Got it" clears the highlight; the page's "Read terms for me" chip stays.
  await expect.poll(async () => (await iris.kinds()).filter((k) => k !== 'chip')).toEqual([]);
  expect(await page.evaluate(() => document.body.querySelector('main')?.outerHTML)).toBe(before);
});

test('checkout: client checks, then a fee that appears after "Continue"', async ({ page }) => {
  await open(page, 'checkout');
  const iris = debug(page);
  expect(await iris.refresh()).toMatchObject({ page_type: 'checkout' });
  const rules = async () => ((await iris.snapshot())?.client_flags ?? []).map((f) => f.rule).sort();
  expect(await rules()).toEqual([
    'countdown_timer',
    'hidden_cookie_reject',
    'prechecked_paid_addon',
    'trial_to_paid',
  ]);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect
    .poll(async () => {
      await iris.refresh();
      return rules();
    })
    .toContain('late_price');
  const late = (await iris.snapshot())?.client_flags.find((f) => f.rule === 'late_price');
  expect(late).toMatchObject({ amount_inr: 79, params: { revision: 2 } });
});
