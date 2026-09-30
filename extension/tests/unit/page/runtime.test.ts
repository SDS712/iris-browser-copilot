import { describe, expect, it } from 'vitest';
import { changedChars, isMeaningfulChange } from '../../../src/page/runtime';
import { snapshot } from '../fakes';

const section = (id: string, text: string) => ({ id, heading: null, level: null, text });

describe('changed characters', () => {
  it('counts only the part that differs', () => {
    expect(changedChars('Offer ends in 09:59. Apply now', 'Offer ends in 09:58. Apply now')).toBe(
      1,
    );
    expect(changedChars('abc', 'abc')).toBe(0);
    expect(changedChars('', 'hello')).toBe(5);
    expect(changedChars('aaaa', 'aa')).toBe(2);
  });
});

describe('meaningful changes', () => {
  const base = snapshot({
    sections: [section('s-1', 'x'.repeat(1_000)), section('s-2', 'y'.repeat(1_000))],
  });

  it('ignores a countdown ticking inside a long section', () => {
    const ticking = {
      ...base,
      sections: [section('s-1', `${'x'.repeat(990)} 09:58`), section('s-2', 'y'.repeat(1_000))],
    };
    const before = {
      ...base,
      sections: [section('s-1', `${'x'.repeat(990)} 09:59`), section('s-2', 'y'.repeat(1_000))],
    };
    expect(isMeaningfulChange(before, ticking)).toBe(false);
  });

  it('ignores small new sections such as a sticky header appearing on scroll', () => {
    const next = {
      ...base,
      sections: [...base.sections, section('s-3', 'Policy:Terms of Use · Tools')],
    };
    expect(isMeaningfulChange(base, next)).toBe(false);
  });

  it('counts sections with real content, and more than 20% of the text changing', () => {
    expect(
      isMeaningfulChange(base, {
        ...base,
        sections: [...base.sections, section('s-3', 'z'.repeat(300))],
      }),
    ).toBe(true);
    expect(
      isMeaningfulChange(base, {
        ...base,
        sections: [section('s-1', 'x'.repeat(1_000)), section('s-2', 'w'.repeat(1_000))],
      }),
    ).toBe(true);
    expect(
      isMeaningfulChange(base, {
        ...base,
        sections: [section('s-1', 'x'.repeat(1_000)), section('s-2', `${'y'.repeat(990)}z`)],
      }),
    ).toBe(false);
  });

  it('counts new controls, prices and flags', () => {
    const price = {
      id: 'i-9',
      label: 'Convenience fee',
      amount_text: '₹49',
      amount_inr: 49,
      first_seen_revision: 2,
    };
    expect(isMeaningfulChange(base, { ...base, prices: [price] })).toBe(true);
    const flag = {
      rule: 'late_price' as const,
      category: 'costs_money' as const,
      severity: 'high' as const,
      element_ids: ['i-9'],
      detail: 'x',
      amount_inr: 49,
      params: {},
    };
    expect(isMeaningfulChange(base, { ...base, client_flags: [flag] })).toBe(true);
  });
});
