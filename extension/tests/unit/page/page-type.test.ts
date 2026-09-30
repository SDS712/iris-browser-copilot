import { describe, expect, it } from 'vitest';
import { pageTypeHint } from '../../../src/page/page-type';
import type { Snapshot } from '../../../src/page/reader';

function snap(overrides: Partial<Snapshot>): Snapshot {
  return {
    contract_version: 1,
    url: 'https://example.com/page',
    title: 'Page',
    lang: 'en',
    page_type_hint: 'other',
    revision: 1,
    captured_at: '2026-09-27T00:00:00Z',
    truncated: false,
    fields: [],
    checkboxes: [],
    buttons: [],
    prices: [],
    sections: [],
    legal_links: [],
    cookie_banner: null,
    client_flags: [],
    ...overrides,
  };
}

const price = (id: string) => ({
  id,
  label: 'Item',
  amount_text: '₹1',
  amount_inr: 1,
  first_seen_revision: 1,
});
const section = (heading: string | null, text = 'Some text.') => ({
  id: `s-${heading ?? 'x'}`,
  heading,
  level: 2,
  text,
});
const field = (id: string) => ({
  id,
  label: id,
  type: 'text' as const,
  required: false,
  placeholder: null,
  help_text: null,
  section: null,
  options: [],
  filled: false,
  sensitive: false,
});

describe('page type hint', () => {
  it('follows the rules in order, including 3b', () => {
    expect(
      pageTypeHint(snap({ url: 'https://x.com/checkout', prices: [price('a'), price('b')] })),
    ).toBe('checkout');
    expect(pageTypeHint(snap({ url: 'https://x.com/checkout', prices: [price('a')] }))).toBe(
      'other',
    );
    expect(
      pageTypeHint(snap({ sections: [section('Review & pay')], prices: [price('a'), price('b')] })),
    ).toBe('checkout');
    expect(pageTypeHint(snap({ title: 'Terms and Conditions' }))).toBe('terms');
    expect(pageTypeHint(snap({ url: 'https://x.com/privacy-policy' }))).toBe('privacy');
    const numbered = [
      '1 Who we are',
      '2 What we collect',
      '3 How we use it',
      '4 Sharing',
      '5 Retention',
    ].map((h) => section(h));
    expect(pageTypeHint(snap({ title: 'Privacy Policy', sections: numbered }))).toBe('privacy');
    expect(pageTypeHint(snap({ sections: numbered }))).toBe('terms');
    expect(pageTypeHint(snap({ fields: ['a', 'b', 'c', 'd'].map(field) }))).toBe('form');
    expect(
      pageTypeHint(snap({ prices: [price('a')], sections: [section('Hero', 'Pay in easy EMI')] })),
    ).toBe('offer');
    const long = 'x'.repeat(401);
    expect(
      pageTypeHint(
        snap({ sections: [section('a', long), section('b', long), section('c', long)] }),
      ),
    ).toBe('article');
    expect(pageTypeHint(snap({}))).toBe('other');
  });
});
