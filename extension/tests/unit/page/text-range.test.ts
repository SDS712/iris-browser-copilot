import { afterEach, describe, expect, it } from 'vitest';
import { findQuoteRange, normaliseQuote } from '../../../src/page/overlay/text-range';
import { loadHtml } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('text ranges for quotes', () => {
  it('normalise whitespace, curly quotes and dashes', () => {
    expect(normaliseQuote('  You can’t   cancel — “ever”  ')).toBe(`you can't cancel - "ever"`);
  });

  it('find a quote across text nodes, inside the section only', () => {
    loadHtml(`
      <h2 id="a">7.2 Cancellation</h2>
      <p>You may cancel <em>QuickCred Plus</em> by giving 30 days’ written   notice.</p>
      <h2 id="b">8 Shield</h2><p>You may cancel QuickCred Plus by giving 30 days' written notice.</p>`);
    const anchor = document.getElementById('a');
    const end = document.getElementById('b');
    if (!anchor || !end) throw new Error('fixture');
    const range = findQuoteRange(
      { anchor, end },
      "You may cancel QuickCred Plus by giving 30 days' written notice.",
    );
    expect(range?.toString().replace(/\s+/g, ' ')).toBe(
      'You may cancel QuickCred Plus by giving 30 days’ written notice.',
    );
    expect(
      end.compareDocumentPosition(range?.endContainer as Node) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(findQuoteRange({ anchor, end }, 'Not on the page at all')).toBeNull();
  });

  it('match across a link inside the sentence', () => {
    loadHtml(`
      <h3 id="a">7.2 Cancellation</h3>
      <p>Give 30 days' written notice to <a href="mailto:x">support@quickcred.example</a>. A fee of ₹499 applies.</p>
      <h3 id="b">7.3 Refunds</h3>`);
    const anchor = document.getElementById('a');
    const end = document.getElementById('b');
    if (!anchor || !end) throw new Error('fixture');
    const quote =
      "Give 30 days' written notice to support@quickcred.example. A fee of ₹499 applies.";
    expect(findQuoteRange({ anchor, end }, quote)?.toString()).toBe(quote);
  });
});
