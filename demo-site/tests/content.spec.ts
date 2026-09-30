import { expect, test, type Page } from '@playwright/test';

/**
 * The legal pages: every required clause and figure is there, the words
 * that would give answers away by accident are not, and the lengths are as specified.
 */

/** Page text with curly quotes straightened, as Markdown's smart quotes change them. */
async function text(page: Page, selector: string): Promise<string> {
  const raw = await page.locator(selector).innerText();
  return raw.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ');
}

const words = (value: string) => value.split(/\s+/).filter(Boolean).length;

/** The words of each h3 clause (up to the next heading), for the 80–250 word rule. */
function clauseWords(page: Page) {
  return page.locator('.legal__body').evaluate((body) => {
    const result: { heading: string; words: number }[] = [];
    let current: { heading: string; words: number } | null = null;
    for (const el of Array.from(body.children)) {
      if (el.tagName === 'H2' || el.tagName === 'H3') {
        current = { heading: el.textContent ?? '', words: 0 };
        result.push(current);
      } else if (current) {
        current.words += (el.textContent ?? '').split(/\s+/).filter(Boolean).length;
      }
    }
    return result.filter((clause) => clause.words > 0);
  });
}

test('terms: every required clause and figure', async ({ page }) => {
  await page.goto('/demo/terms');
  const body = await text(page, 'main');
  const required = [
    'Loans up to ₹5,00,000',
    'Interest 1.5% p.m. flat',
    'Tenures from 3 to 24 months',
    'Easy automatic repayments',
    'Last updated: 1 September 2026',
    'paid directly to the merchant',
    '1.5% per month flat on the original principal for the full tenure',
    '2% of the loan amount plus GST',
    'non-refundable',
    "7 days' notice by SMS or email",
    'on the 5th of every month through the NACH e-mandate or UPI AutoPay set up at application',
    'up to 1.5 times the EMI',
    "can't be cancelled while any amount is outstanding",
    'A late fee of ₹500 is charged for each missed instalment',
    'A bounce charge of ₹590 (₹500 + GST) is charged for each failed debit',
    'Overdue interest of 3% per month',
    'reported to credit bureaus',
    'No foreclosure is allowed in the first 3 months',
    'a foreclosure charge of 4% of the outstanding principal plus GST',
    "Part-prepayment isn't allowed",
    '₹199 per month after a 30-day free trial',
    'renewing monthly until cancelled',
    "You may cancel QuickCred Plus by giving 30 days' written notice to support@quickcred.example. A cancellation fee of ₹499 applies if you cancel within the first six months.",
    'No refunds are given for part months',
    '₹1,299 per year, added at checkout',
    'renews automatically every year and is charged through the mandate unless cancelled at least 15 days before the renewal date',
    'Claims follow the Shield policy wording',
    'sharing their information with partners, affiliates, credit bureaus and service providers, including for marketing',
    'even if registered on the Do Not Disturb list',
    'a sole arbitrator appointed by QuickCred',
    'The seat of arbitration is Pune',
    'waives the right to join a class action',
    'by posting them on its website',
    'means acceptance of the revised terms',
    'grievance@quickcred.example',
    'replies within 30 days',
  ];
  for (const phrase of required) expect(body, phrase).toContain(phrase);
});

test('terms: never says "grace" or "period" anywhere on the page', async ({ page }) => {
  await page.goto('/demo/terms');
  const all = (await text(page, 'body')).toLowerCase();
  expect(all).not.toContain('grace');
  expect(all).not.toContain('period');
});

test('terms: numbered headings, clause lengths and total length', async ({ page }) => {
  await page.goto('/demo/terms');
  const h2 = await page.locator('.legal__body h2').allInnerTexts();
  expect(h2).toHaveLength(12);
  expect(h2.every((heading, i) => heading.startsWith(`${String(i + 1)} `))).toBe(true);
  const h3 = await page.locator('.legal__body h3').allInnerTexts();
  expect(h3).toContain('7.2 Cancellation');
  expect(h3.every((heading) => /^\d+\.\d+ \S/.test(heading))).toBe(true);
  for (const clause of await clauseWords(page)) {
    expect(clause.words, clause.heading).toBeGreaterThanOrEqual(80);
    expect(clause.words, clause.heading).toBeLessThanOrEqual(250);
  }
  const total = words(await text(page, '.legal__body'));
  expect(total).toBeGreaterThanOrEqual(2_500);
  expect(total).toBeLessThanOrEqual(4_000);
});

test('privacy: every required statement, never "sell", and its length', async ({ page }) => {
  await page.goto('/demo/privacy');
  const body = await text(page, 'main');
  const required = [
    'QuickCred Privacy Policy',
    'Last updated: 1 September 2026',
    '12 Example Road, Pune 411001 (fictional address)',
    'privacy@quickcred.example',
    'name, PAN and date of birth',
    'bank account',
    'monthly income',
    'device and app data, including your contact list, SMS metadata and precise location when you use our app',
    'credit decisions',
    'collections',
    'fraud prevention',
    'personalised offers',
    'partners, affiliates, lenders, credit bureaus, collection agencies, marketing partners and service providers',
    'as long as necessary for our business purposes or as required by law',
    'delete your data by emailing privacy@quickcred.example',
    'We may keep some data where the law requires',
    'replying STOP',
    'Manage choices',
    'posting the updated version on our website',
    'grievance officer',
    'grievance@quickcred.example',
  ];
  for (const phrase of required) expect(body, phrase).toContain(phrase);
  expect((await text(page, 'body')).toLowerCase()).not.toContain('sell');
  const h2 = await page.locator('.legal__body h2').allInnerTexts();
  expect(h2).toHaveLength(10);
  const total = words(await text(page, '.legal__body'));
  expect(total).toBeGreaterThanOrEqual(1_500);
  expect(total).toBeLessThanOrEqual(2_500);
});
