import { expect, test } from '@playwright/test';
import { iris, openDemo, rules } from './iris';

/** Journey tests with mock voice and the backend in fake mode. */

test('offer: a flat-rate flag with the loan facts, a countdown, and a true cost of 36.5%', async ({
  page,
}) => {
  await openDemo(page, '/demo/');
  const d = iris(page);
  expect(await d.refresh()).toMatchObject({ page_type: 'offer' });
  const snapshot = await d.snapshot();
  const flat = snapshot?.client_flags.find((f) => f.rule === 'flat_rate_offer');
  expect(flat?.params).toEqual({
    rate_percent: 1.5,
    rate_basis: 'flat_monthly',
    tenure_months: 12,
    principal_inr: 59999,
  });
  expect(await rules(page)).toContain('countdown_timer');
  const result = await d.runTool('calculate_loan_cost');
  expect(result).toMatchObject({ card: { kind: 'true_cost', figure_text: '≈ 36.5% a year' } });
  await page.evaluate(() => {
    window.Iris?.open();
  });
  await expect(page.locator('iris-widget').getByText('≈ 36.5% a year')).toBeVisible();
});

test('apply: nothing typed reaches the backend; account number and OTP are sensitive', async ({
  page,
}) => {
  const bodies: string[] = [];
  await page.route('**/api/pages', async (route) => {
    bodies.push(route.request().postData() ?? '');
    await route.continue();
  });
  await openDemo(page, '/demo/apply');
  const typed: string[] = [];
  const inputs = page.locator('main input:not([type=checkbox]):not([type=radio])');
  for (let i = 0; i < (await inputs.count()); i += 1) {
    const input = inputs.nth(i);
    const type = await input.getAttribute('type');
    const value =
      type === 'date'
        ? '1991-04-23'
        : type === 'number'
          ? `8${String(i)}${String(i)}51`
          : `TYPED${String(i)}Q${String(i * 7)}`;
    await input.fill(value);
    typed.push(value);
  }
  await page.getByLabel('Employment type').selectOption('Student');
  await page.getByLabel('Nominee relationship').selectOption('Sibling');
  await page.getByLabel('UPI AutoPay').check();
  expect(typed).toHaveLength(12);
  await iris(page).refresh();
  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) for (const value of typed) expect(body).not.toContain(value);
  const fields = (await iris(page).snapshot())?.fields ?? [];
  const byLabel = new Map(fields.map((f) => [f.label, f]));
  expect(byLabel.get('Bank account number')).toMatchObject({ sensitive: true, filled: true });
  expect(byLabel.get('OTP')).toMatchObject({ sensitive: true, placeholder: null });
});

test('apply: 9 seconds on CKYC brings the "Explain" chip; the field is explained from the web', async ({
  page,
}) => {
  await page.clock.install();
  await openDemo(page, '/demo/apply');
  await iris(page).refresh();
  await page.getByLabel('CKYC number (optional)').focus();
  await page.clock.runFor(9_500);
  await expect(page.locator('iris-overlay').getByRole('button', { name: 'Explain' })).toBeVisible();
  expect((await iris(page).state())?.chips.map((c) => c.label)).toEqual(['Explain']);
  const result = await iris(page).runTool('explain_field', { field_label: 'CKYC number' });
  expect(result).toMatchObject({ card: { kind: 'field', source: 'web' } });
});

test('terms: the scan finds the five kinds of risk; ask_page answers from the clause and marks it', async ({
  page,
}) => {
  await openDemo(page, '/demo/terms');
  const d = iris(page);
  const registered = await d.refresh();
  expect(registered).toMatchObject({ page_type: 'terms' });
  const categories = async () => {
    const response = await page.request.get(`/api/pages/${registered?.page_id ?? ''}/scan`);
    const scan = (await response.json()) as { status: string; risks: { category: string }[] };
    return scan.status === 'ready' ? scan.risks.map((r) => r.category) : [];
  };
  await expect
    .poll(categories)
    .toEqual(
      expect.arrayContaining([
        'auto_debit',
        'costs_money',
        'auto_renews',
        'shares_data',
        'limits_rights',
      ]),
    );
  const answer = await d.runTool('ask_page', { question: 'Can I cancel QuickCred Plus anytime?' });
  expect(answer).toMatchObject({ card: { kind: 'answer', source: 'page' }, not_found: false });
  await expect.poll(d.kinds).toContain('marker');
});

test('checkout: the cookie banner, the pre-ticked traps, a late fee after Continue, and the reject chip', async ({
  page,
}) => {
  await openDemo(page, '/demo/checkout');
  const banner = page.getByRole('region', { name: 'Cookie consent' });
  await expect(banner).toBeVisible();
  const d = iris(page);
  expect(await d.refresh()).toMatchObject({ page_type: 'checkout' });
  const first = await d.snapshot();
  expect(first?.client_flags.map((f) => f.rule)).toEqual(
    expect.arrayContaining(['prechecked_paid_addon', 'trial_to_paid']),
  );
  const warranty = first?.checkboxes.find((c) => c.label.startsWith('Extended warranty'));
  expect(warranty).toBeDefined();
  const flagged = first?.client_flags.flatMap((f) => f.element_ids) ?? [];
  expect(flagged).not.toContain(warranty?.id);
  expect(await rules(page)).not.toContain('late_price');

  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Review & pay' })).toBeVisible();
  await expect
    .poll(async () => {
      await d.refresh();
      return rules(page);
    })
    .toContain('late_price');
  const late = (await d.snapshot())?.client_flags.filter((f) => f.rule === 'late_price') ?? [];
  expect(late).toHaveLength(1);
  expect(late[0]).toMatchObject({ amount_inr: 49 });
  expect(late[0]?.params.revision).toBeGreaterThanOrEqual(2);

  const chip = page.locator('iris-overlay').getByRole('button', { name: 'Show reject option' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect.poll(d.kinds).toContain('ring');
  const manageId = (await d.snapshot())?.cookie_banner?.manage_button_id;
  expect((await d.state())?.highlight_ids).toEqual([manageId]);
  await expect(
    page.locator('iris-overlay').getByText("The reject option is inside 'Manage choices'."),
  ).toBeVisible();
});

test('payment failed: a real UPI error code, with no explanation on the page', async ({ page }) => {
  await page.goto('/demo/checkout');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('link', { name: /Pay ₹1,348 with UPI \(demo\)/ }).click();
  await expect(page).toHaveURL(/\/demo\/payment-failed/);
  await expect(page.getByRole('heading', { name: 'Payment failed' })).toBeVisible();
  await expect(page.getByText('Error code: U16')).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/risk|threshold|limit/i);
  await page.getByRole('button', { name: 'Contact support' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'This is a demo. Nothing was sent.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute(
    'href',
    '/demo/checkout',
  );
});

test('landing page: no widget; the demo link and the extension download work', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A second pair of eyes on every page.' }),
  ).toBeVisible();
  expect(await page.locator('script[src*="iris-widget"]').count()).toBe(0);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.Iris === undefined)).toBe(true);
  await expect(page.locator('iris-widget')).toHaveCount(0);

  const download = page.getByRole('link', { name: 'Download the extension (.zip)' });
  await expect(download).toHaveAttribute('href', '/downloads/iris-extension.zip');
  const zip = await page.request.get('/downloads/iris-extension.zip');
  expect(zip.status()).toBe(200);
  expect((await zip.body()).subarray(0, 2).toString()).toBe('PK');

  await page.getByRole('link', { name: 'Get the Chrome extension' }).click();
  await expect(page).toHaveURL(/#install$/);
  await page.getByRole('link', { name: 'Try the live demo' }).click();
  await expect(page).toHaveURL(/\/demo\/$/);
  await expect(page.getByRole('heading', { name: 'Own the Nimbus 14 today.' })).toBeVisible();
});

test('404: QuickCred-styled, with links to the demo and to Iris, and no widget', async ({
  page,
}) => {
  const response = await page.goto('/demo/nothing-here');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: "We couldn't find that page" })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to the QuickCred demo' })).toHaveAttribute(
    'href',
    '/demo/',
  );
  await expect(page.getByRole('link', { name: 'About Iris' })).toHaveAttribute('href', '/');
  expect(await page.locator('script[src*="iris-widget"]').count()).toBe(0);
});
