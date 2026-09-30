import { afterEach, describe, expect, it, vi } from 'vitest';
import { CountdownDetector, type ClientFlag } from '../../../src/page/rules';
import { loadHtml, newReader, snapshotOf } from './helpers';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function flagsFor(html: string): ClientFlag[] {
  loadHtml(html);
  const { reader } = newReader();
  return snapshotOf(reader).snapshot.client_flags;
}

const rules = (flags: ClientFlag[]) => flags.map((f) => f.rule);

describe('prechecked_paid_addon', () => {
  it('flags a pre-ticked choice with an amount', () => {
    const [flag] = flagsFor(
      '<input type="checkbox" id="a" checked><label for="a">Protect your purchase: QuickCred Shield ₹1,299/year</label>',
    );
    expect(flag).toMatchObject({
      rule: 'prechecked_paid_addon',
      category: 'costs_money',
      severity: 'high',
      amount_inr: 1299,
      params: { period: 'year' },
    });
  });

  it('ignores unticked boxes and boxes the user has touched', () => {
    expect(
      flagsFor('<input type="checkbox" id="a"><label for="a">Extended warranty ₹2,499</label>'),
    ).toEqual([]);
    loadHtml('<input type="checkbox" id="a" checked><label for="a">Add-on ₹299</label>');
    const { reader } = newReader();
    const stop = reader.trackInteraction();
    reader.read(1);
    document.getElementById('a')?.dispatchEvent(new Event('change', { bubbles: true }));
    expect(snapshotOf(reader, 2).snapshot.client_flags).toEqual([]);
    stop();
  });
});

describe('prechecked_marketing_consent', () => {
  it('flags a pre-ticked marketing box with no amount', () => {
    const flags = flagsFor(
      '<input type="checkbox" id="a" checked><label for="a">Send me offers from QuickCred and partners on WhatsApp and SMS</label>',
    );
    expect(flags).toMatchObject([
      { rule: 'prechecked_marketing_consent', category: 'shares_data', severity: 'medium' },
    ]);
  });

  it('ignores it when unticked, and never flags the terms box', () => {
    expect(
      flagsFor('<input type="checkbox" id="a"><label for="a">Send me offers on WhatsApp</label>'),
    ).toEqual([]);
    expect(
      flagsFor('<input type="checkbox" id="a" checked><label for="a">I agree to the Terms</label>'),
    ).toEqual([]);
  });
});

describe('trial_to_paid', () => {
  it('is high when pre-ticked and replaces the paid add-on flag', () => {
    const flags = flagsFor(
      '<input type="checkbox" id="a" checked><label for="a">QuickCred Plus: free for 30 days, then ₹199/month</label>',
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      rule: 'trial_to_paid',
      category: 'auto_renews',
      severity: 'high',
      params: { trial_days: 30, then_inr: 199, then_period: 'month' },
    });
  });

  it('is medium when not ticked, and also reads "N-day free trial, then" rows', () => {
    expect(
      flagsFor(
        '<input type="checkbox" id="a"><label for="a">Club: free for 1 month, then ₹99 per month</label>',
      )[0],
    ).toMatchObject({
      severity: 'medium',
      params: { trial_days: 30, then_inr: 99, then_period: 'month' },
    });
    expect(
      flagsFor('<div><span>30-day free trial, then</span> <span>₹1,999/year</span></div>')[0],
    ).toMatchObject({
      rule: 'trial_to_paid',
      params: { trial_days: 30, then_inr: 1999, then_period: 'year' },
    });
  });

  it('ignores a plain free offer', () => {
    expect(rules(flagsFor('<p>Free delivery for 30 days on all orders.</p>'))).not.toContain(
      'trial_to_paid',
    );
  });
});

describe('late_price', () => {
  const page = `
    <div id="summary"><div><span>Laptop</span> <span>₹59,999</span></div>
    <div><span>Paid with EMI:</span> <span>₹5,900/month × 12</span></div>
    <div><span>Due today</span> <span>₹1,299</span></div></div>
    <div id="review" hidden>
      <div><span>Laptop</span> <span>₹59,999</span></div>
      <div><span>Convenience fee</span> <span>₹49</span></div>
      <div><span>Due today</span> <span>₹1,348</span></div>
      <p><span>₹5,900/month for 12 months, first instalment on the 5th of next month</span></p>
    </div>`;

  it('flags a new kind of charge that appears in a later revision', () => {
    loadHtml(page);
    const { reader } = newReader();
    expect(rules(snapshotOf(reader, 1).snapshot.client_flags)).toEqual([]);
    document.getElementById('review')?.removeAttribute('hidden');
    const flags = snapshotOf(reader, 2).snapshot.client_flags;
    expect(flags).toMatchObject([
      {
        rule: 'late_price',
        category: 'costs_money',
        severity: 'high',
        amount_inr: 49,
        params: { revision: 2 },
      },
    ]);
  });

  it('ignores totals, repeated labels, repeated amounts and first-load prices', () => {
    loadHtml(page.replace(' hidden', ''));
    const { reader } = newReader();
    expect(rules(snapshotOf(reader, 1).snapshot.client_flags)).toEqual([]);
  });
});

describe('flat_rate_offer', () => {
  it('reads the rate, and tenure and principal from the same section', () => {
    const [flag] = flagsFor(`
      <h1>Own the Nimbus 14 today.</h1>
      <div><span>Nimbus 14 laptop</span> <span>₹59,999</span></div>
      <div><span>Monthly instalment</span> <span>₹5,900/month</span></div>
      <p>*12 monthly instalments at 1.5% p.m. flat. Processing fee ₹1,416 (2% + GST), deducted upfront.</p>
      <h2>How it works</h2><p>Apply in 3 minutes.</p>`);
    expect(flag).toMatchObject({
      rule: 'flat_rate_offer',
      category: 'costs_money',
      severity: 'medium',
      params: {
        rate_percent: 1.5,
        rate_basis: 'flat_monthly',
        tenure_months: 12,
        principal_inr: 59999,
      },
    });
  });

  it('reads yearly flat rates, and leaves out facts that are ranges or caps', () => {
    const [flag] = flagsFor(
      '<h2>Key terms</h2><ul><li>Loans up to ₹5,00,000</li><li>Interest 12% flat</li><li>Tenures from 3 to 24 months</li></ul>',
    );
    expect(flag?.params).toEqual({ rate_percent: 12, rate_basis: 'flat_annual' });
  });

  it('ignores reducing rates', () => {
    expect(flagsFor('<p>Interest at 14% p.a. on the reducing balance.</p>')).toEqual([]);
  });
});

describe('hidden_cookie_reject', () => {
  const banner = (reject: string) => `
    <style>.b { position: fixed; bottom: 0; }</style>
    <div class="b"><p>We use cookies.</p><button>Accept all</button><button>Manage choices</button>${reject}</div>`;

  it('flags a banner whose reject option is hidden', () => {
    expect(flagsFor(banner('<div hidden><button>Reject all</button></div>'))).toMatchObject([
      { rule: 'hidden_cookie_reject', category: 'worth_knowing', severity: 'info' },
    ]);
  });

  it('ignores a banner with a visible reject button, or no banner', () => {
    expect(flagsFor(banner('<button>Reject all</button>'))).toEqual([]);
    expect(flagsFor('<p>We use cookies.</p><button>Accept all</button>')).toEqual([]);
  });
});

describe('countdown_timer', () => {
  it('flags a clock near urgency words that changes between two samples', async () => {
    loadHtml(
      '<p>Offer ends in <span id="t">09:59</span></p><p>Open <span id="s">10:30</span> daily</p>',
    );
    const sleep = vi.fn(() => {
      const t = document.getElementById('t');
      if (t) t.textContent = '09:58';
      return Promise.resolve();
    });
    const detector = new CountdownDetector(sleep);
    const { reader, registry } = newReader();
    const read = reader.read(1);
    const running = await detector.running(read.clockCandidates);
    expect(running.map((el) => el.id)).toEqual(['t']);
    expect(sleep).toHaveBeenCalledTimes(1);
    const flags = snapshotOf(
      reader,
      1,
      running.map((el) => registry.idFor(el, 'i')),
    ).snapshot.client_flags;
    expect(flags).toMatchObject([
      { rule: 'countdown_timer', category: 'worth_knowing', severity: 'info' },
    ]);
    await detector.running(reader.read(2).clockCandidates);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('ignores a clock that stays still', async () => {
    loadHtml('<p>Offer ends at <span>18:00</span></p>');
    const detector = new CountdownDetector(() => Promise.resolve());
    const { reader } = newReader();
    expect(await detector.running(reader.read(1).clockCandidates)).toEqual([]);
  });
});
