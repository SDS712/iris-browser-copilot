import { expect, test, type Page } from '@playwright/test';
import type { IrisDebug } from '../../src/core/debug';

const FLAGS = '?iris_mock_voice=1&iris_debug=1';

async function open(page: Page, name: string) {
  await page.goto(`/pages/${name}.html${FLAGS}`);
  await page.waitForFunction(() => window.IrisDebug !== undefined);
  await page.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
}

function runTool(page: Page, name: string, args: Record<string, unknown> = {}) {
  return page.evaluate(([n, a]) => (window.IrisDebug as IrisDebug).runTool(n, a), [
    name,
    args,
  ] as const);
}

const kinds = (page: Page) =>
  page.evaluate(async () =>
    (await (window.IrisDebug as IrisDebug).overlayRects()).map((r) => r.kind),
  );

/** The newest card in the panel (an open Shadow DOM in the harness). */
const newestCard = (page: Page) => page.locator('iris-widget article.iris-card').first();

test('every tool renders its card in fake mode', async ({ page }) => {
  await open(page, 'terms');
  await runTool(page, 'ask_page', { question: 'Can I cancel anytime?' });
  await expect(newestCard(page)).toContainText('From this page');
  await runTool(page, 'summarize_page', { style: 'quick' });
  await expect(newestCard(page)).toContainText('Summary');
  await runTool(page, 'scan_page_risks');
  await expect(
    newestCard(page).getByRole('button', { name: 'Show on page' }).first(),
  ).toBeVisible();
  await runTool(page, 'web_lookup', { query: 'what is NACH' });
  await expect(newestCard(page)).toContainText('From the web · 2 sources');
  await runTool(page, 'calculate_loan_cost', {
    principal_inr: 59999,
    rate_percent: 1.5,
    rate_basis: 'flat_monthly',
    tenure_months: 12,
    processing_fee_inr: 1416,
  });
  await expect(newestCard(page)).toContainText('≈ 36.5% a year');
  await runTool(page, 'check_site_trust');
  await expect(newestCard(page)).toContainText('Checks:');
  const overview = await runTool(page, 'get_page_overview');
  expect(overview).toMatchObject({ overview: expect.stringContaining('PAGE:') });

  await open(page, 'form');
  const web = await runTool(page, 'explain_field', { field_label: 'CKYC number' });
  expect(web).toMatchObject({ card: { kind: 'field', source: 'web' } });
  await expect(newestCard(page)).toContainText('From the web');
  const pan = await runTool(page, 'explain_field', { field_label: 'PAN' });
  expect(pan).toMatchObject({ card: { kind: 'field' } });
  await expect.poll(() => kinds(page)).toContain('ring');
});

test('"Show on page", "Show field" and "Review" highlight from the panel', async ({ page }) => {
  await open(page, 'form');
  await runTool(page, 'explain_field', { field_label: 'PAN' });
  await page.keyboard.press('Escape');
  await expect.poll(() => kinds(page)).toEqual([]);
  await newestCard(page).getByRole('button', { name: 'Show field' }).click();
  await expect.poll(() => kinds(page)).toContain('ring');

  await open(page, 'checkout');
  const panel = page.locator('iris-widget');
  // The page strip sits under the header of the active view.
  await page.evaluate(() => (window.IrisDebug as IrisDebug).startSession());
  await expect(panel.getByRole('button', { name: 'Review ▸' })).toBeVisible();
  await panel.getByRole('button', { name: 'Review ▸' }).click();
  const list = newestCard(page);
  await expect(list.getByRole('listitem').first()).toBeVisible();
  await list.getByRole('button', { name: 'Show on page' }).first().click();
  await expect.poll(() => kinds(page)).toEqual(expect.arrayContaining(['risk_ring', 'bubble']));
});

test('"this" means what the mouse rests on', async ({ page }) => {
  await open(page, 'form');
  // Resting beside the field, over nothing else, still counts: it's the nearest one. (The
  // open panel covers the right-hand side, and Iris's own widget never counts.)
  await page.locator('#ifsc').scrollIntoViewIfNeeded();
  const box = await page.locator('#ifsc').boundingBox();
  if (!box) throw new Error('No IFSC field');
  await page.mouse.move(box.x - 40, box.y + box.height / 2);
  await page.waitForTimeout(700);
  const field = await runTool(page, 'explain_field');
  expect(field).toMatchObject({ card: { kind: 'field', topic: 'IFSC' } });

  await open(page, 'terms');
  await page.getByText('6 Early repayment of instalments').hover();
  await page.waitForTimeout(700);
  const answer = await runTool(page, 'ask_page', { question: 'What does this mean?' });
  expect(answer).toMatchObject({
    card: { quote: { section_heading: '6 Early repayment of instalments' } },
  });
});
