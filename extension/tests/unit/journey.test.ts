import { describe, expect, it, vi } from 'vitest';
import {
  BOUNCE_MS,
  compareWithEarlier,
  CONTEXT_CHARS,
  digest,
  entryFor,
  factLine,
  JOURNEY_IDLE_MS,
  JourneyTrail,
  memoryStorage,
  sessionJourneyStorage,
  type JourneyEntry,
} from '../../src/core/journey';
import { TabJourneys } from '../../src/extension/tab-memory';
import { snapshot } from './fakes';

const LONG_TEXT = 'Words about the loan. '.repeat(20);

function entry(n: number, overrides: Partial<JourneyEntry> = {}): JourneyEntry {
  return {
    page_id: `pg_${String(n)}`,
    url: `https://shop.example/page-${String(n)}`,
    title: `Page ${String(n)}`,
    page_type: 'other',
    visited_at: n * 10_000,
    prices: [],
    rate: null,
    thin: false,
    risks: [],
    ...overrides,
  };
}

function trail(options: { summarise?: () => Promise<string> } = {}) {
  let clock = 0;
  const onChange = vi.fn();
  const summarise = vi.fn(options.summarise ?? (() => Promise.resolve('Model summary.')));
  const journey = new JourneyTrail({
    storage: memoryStorage(),
    summarise,
    onChange,
    now: () => clock,
  });
  return {
    journey,
    summarise,
    onChange,
    at: (ms: number) => {
      clock = ms;
    },
  };
}

describe('journey entries', () => {
  it('keeps labelled prices and a flat-rate offer’s terms, never page text', () => {
    const facts = entryFor(
      'pg_1',
      'offer',
      snapshot({
        url: 'https://shop.example/offer',
        title: 'Own it today',
        prices: [
          {
            id: 'i-3',
            label: 'Processing fee',
            amount_text: '₹999',
            amount_inr: 999,
            first_seen_revision: 1,
          },
          { id: 'i-4', label: null, amount_text: '₹5', amount_inr: 5, first_seen_revision: 1 },
        ],
        client_flags: [
          {
            rule: 'flat_rate_offer',
            category: 'costs_money',
            severity: 'medium',
            element_ids: ['s-2'],
            detail: 'x',
            amount_inr: null,
            params: {
              rate_percent: 1.5,
              rate_basis: 'flat_monthly',
              tenure_months: 12,
              principal_inr: 59999,
            },
          },
        ],
        sections: [{ id: 's-2', heading: 'Offer', level: 2, text: LONG_TEXT }],
      }),
      5,
    );
    expect(facts.prices).toEqual([
      { id: 'i-3', label: 'Processing fee', amount_inr: 999, amount_text: '₹999' },
    ]);
    expect(facts.rate).toEqual({
      element_id: 's-2',
      rate_percent: 1.5,
      rate_basis: 'flat_monthly',
      tenure_months: 12,
      principal_inr: 59999,
    });
    expect(facts.thin).toBe(false);
    expect(factLine(facts)).toBe(
      'Own it today (offer, shop.example): Processing fee ₹999: rate 1.5% flat monthly, 12 months',
    );
    expect(JSON.stringify(facts)).not.toContain('Words about the loan');
  });

  it('marks a near-empty page as thin', () => {
    expect(entryFor('pg_1', 'other', snapshot({ sections: [] }), 0).thin).toBe(true);
  });
});

describe('the trail', () => {
  it('lists earlier pages newest first, without the current one', () => {
    const { journey } = trail();
    for (const n of [1, 2, 3]) journey.arrive(entry(n), false);
    expect(journey.current?.page_id).toBe('pg_3');
    expect(journey.earlierPageIds()).toEqual(['pg_2', 'pg_1']);
  });

  it('replaces the current entry for a revision of the same document', () => {
    const { journey } = trail();
    journey.arrive(entry(1), false);
    journey.arrive(entry(1, { page_id: 'pg_1b', visited_at: 99_000 }), true);
    expect(journey.entries.map((e) => e.page_id)).toEqual(['pg_1b']);
    expect(journey.current?.visited_at).toBe(10_000);
  });

  it('drops a page left within 3 seconds, and a thin page', () => {
    const { journey } = trail();
    journey.arrive(entry(1), false);
    journey.arrive(entry(2, { visited_at: 20_000 }), false);
    journey.arrive(entry(3, { visited_at: 20_000 + BOUNCE_MS - 1 }), false);
    expect(journey.entries.map((e) => e.page_id)).toEqual(['pg_1', 'pg_3']);
    journey.arrive(entry(4, { thin: true, visited_at: 60_000 }), false);
    journey.arrive(entry(5, { visited_at: 90_000 }), false);
    expect(journey.entries.map((e) => e.page_id)).toEqual(['pg_1', 'pg_3', 'pg_5']);
  });

  it('moves a revisited page to the end instead of listing it twice', () => {
    const { journey } = trail();
    for (const n of [1, 2]) journey.arrive(entry(n), false);
    journey.arrive(
      entry(9, { url: 'https://shop.example/page-1#fees', visited_at: 90_000 }),
      false,
    );
    expect(journey.entries.map((e) => e.page_id)).toEqual(['pg_2', 'pg_9']);
  });

  it('folds 10 pages into a summary at the 11th, and starts a new list', async () => {
    const { journey, summarise, onChange } = trail();
    for (let n = 1; n <= 11; n += 1) journey.arrive(entry(n), false);
    expect(journey.entries.map((e) => e.page_id)).toEqual(['pg_11']);
    const lines = Array.from({ length: 10 }, (_, i) => factLine(entry(i + 1)));
    expect(summarise).toHaveBeenCalledWith(lines, null);
    // The code-built digest stands in until the model's summary arrives.
    expect(journey.summary).toBe(
      digest(
        null,
        Array.from({ length: 10 }, (_, i) => entry(i + 1)),
      ),
    );
    await vi.waitFor(() => {
      expect(journey.summary).toBe('Model summary.');
    });
    expect(onChange).toHaveBeenCalled();
    for (let n = 12; n <= 21; n += 1) journey.arrive(entry(n), false);
    expect(summarise).toHaveBeenLastCalledWith(expect.any(Array), 'Model summary.');
  });

  it('keeps the digest when the summary call fails', async () => {
    const { journey } = trail({ summarise: () => Promise.reject(new Error('down')) });
    for (let n = 1; n <= 11; n += 1) journey.arrive(entry(n), false);
    await Promise.resolve();
    expect(journey.summary).toContain('Page 1 (other, shop.example)');
  });

  it('is forgotten 30 minutes after the last activity, and activity keeps it', () => {
    const { journey, at } = trail();
    at(0);
    journey.arrive(entry(1), false);
    at(JOURNEY_IDLE_MS - 1);
    journey.touch();
    at(2 * JOURNEY_IDLE_MS - 2);
    expect(journey.entries).toHaveLength(1);
    at(2 * JOURNEY_IDLE_MS);
    expect(journey.entries).toHaveLength(0);
  });

  it('notes the scan’s risks on the page they belong to', () => {
    const { journey, onChange } = trail();
    journey.arrive(entry(1), false);
    onChange.mockClear();
    journey.noteRisks('pg_1', ['Auto-debit']);
    journey.noteRisks('pg_1', ['Auto-debit']);
    expect(journey.current?.risks).toEqual(['Auto-debit']);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('gives the agent the earlier pages and the summary, capped', async () => {
    const { journey } = trail();
    expect(journey.contextBlock()).toBe('');
    for (let n = 1; n <= 12; n += 1) journey.arrive(entry(n), false);
    await vi.waitFor(() => {
      expect(journey.summary).toBe('Model summary.');
    });
    expect(journey.contextBlock()).toBe(
      'EARLIER IN THIS TAB (newest first):\n- Page 11 (other, shop.example)\n' +
        'EARLIER NAVIGATION SUMMARY: Model summary.',
    );
    const long = trail({ summarise: () => Promise.resolve('x'.repeat(5_000)) });
    for (let n = 1; n <= 12; n += 1) long.journey.arrive(entry(n), false);
    await Promise.resolve();
    expect(long.journey.contextBlock().length).toBeLessThanOrEqual(CONTEXT_CHARS);
  });
});

describe('storage', () => {
  it('survives in sessionStorage, and forgets on null', () => {
    const storage = sessionJourneyStorage('test.journey');
    storage.save({ entries: [entry(1)], summary: null, last_active: 1 });
    expect(storage.load()?.entries[0]?.page_id).toBe('pg_1');
    storage.save(null);
    expect(storage.load()).toBeNull();
  });

  it('keeps one journey per tab in the side panel', () => {
    let tab: number | null = 1;
    const journeys = new TabJourneys(() => tab);
    journeys.storage.save({ entries: [entry(1)], summary: null, last_active: 1 });
    tab = 2;
    expect(journeys.storage.load()).toBeNull();
    tab = 1;
    expect(journeys.storage.load()?.entries).toHaveLength(1);
    journeys.forget(1);
    expect(journeys.storage.load()).toBeNull();
    tab = null;
    journeys.storage.save({ entries: [], summary: null, last_active: 1 });
    expect(journeys.storage.load()).toBeNull();
  });
});

describe('figures that change between pages of the same site', () => {
  const fee = (id: string, amount: number) => ({
    id,
    label: 'Processing fee:',
    amount_inr: amount,
    amount_text: `₹${amount.toLocaleString('en-IN')}`,
  });

  it('notices the same price label with another amount', () => {
    const offer = entry(1, { page_type: 'offer', prices: [fee('i-2', 999)] });
    const checkout = entry(2, { page_type: 'checkout', prices: [fee('i-7', 1416)] });
    expect(compareWithEarlier(checkout, [offer])).toEqual({
      key: 'journey:processing fee:999:1416',
      say: 'Heads up: the processing fee here is ₹1,416, but the offer page said ₹999.',
      element_id: 'i-7',
    });
  });

  it('names an earlier page of the same kind by its title', () => {
    const cart = entry(1, { page_type: 'checkout', title: 'Your cart', prices: [fee('i-2', 999)] });
    const checkout = entry(2, { page_type: 'checkout', prices: [fee('i-7', 1416)] });
    expect(compareWithEarlier(checkout, [cart])?.say).toBe(
      'Heads up: the processing fee here is ₹1,416, but the page “Your cart” said ₹999.',
    );
  });

  it('says nothing for the same amount, or for another site', () => {
    const offer = entry(1, { prices: [fee('i-2', 999)] });
    expect(compareWithEarlier(entry(2, { prices: [fee('i-7', 999)] }), [offer])).toBeNull();
    const elsewhere = entry(2, { url: 'https://other.example/x', prices: [fee('i-7', 1416)] });
    expect(compareWithEarlier(elsewhere, [offer])).toBeNull();
  });

  it('notices a flat rate with other terms', () => {
    const rate = (percent: number) => ({
      element_id: 's-3',
      rate_percent: percent,
      rate_basis: 'flat_monthly',
      tenure_months: 12,
      principal_inr: 59999,
    });
    const offer = entry(1, { page_type: 'offer', rate: rate(1.5) });
    const terms = entry(2, { page_type: 'terms', rate: rate(2) });
    expect(compareWithEarlier(terms, [offer])?.say).toBe(
      'Heads up: the rate here is 2% flat monthly, 12 months, but the offer page said 1.5% flat monthly, 12 months.',
    );
  });
});
