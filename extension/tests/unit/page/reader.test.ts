import { afterEach, describe, expect, it } from 'vitest';
import { findAmounts, parseInr } from '../../../src/page/amounts';
import { cleanLabel, LIMITS } from '../../../src/page/reader';
import { loadHtml, newReader, snapshotOf } from './helpers';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('amounts', () => {
  it('parses ₹, Rs, Rs. and INR with Indian grouping', () => {
    expect(parseInr('₹1,00,000')).toBe(100000);
    expect(parseInr('Rs. 59,999 only')).toBe(59999);
    expect(parseInr('Rs 499')).toBe(499);
    expect(parseInr('INR 1,299.50')).toBe(1299.5);
    expect(parseInr('₹5,00,000')).toBe(500000);
    expect(parseInr('no money here')).toBeNull();
  });

  it('keeps the period suffix as shown', () => {
    const [monthly] = findAmounts('then ₹199/month after');
    expect(monthly).toMatchObject({ text: '₹199/month', inr: 199, period: 'month' });
    expect(findAmounts('₹1,299 per year')[0]?.period).toBe('year');
    expect(findAmounts('₹5,900 p.m.')[0]?.period).toBe('month');
    expect(findAmounts('₹49')[0]?.period).toBeNull();
  });

  it('cleans a row label', () => {
    expect(cleanLabel('QuickCred Shield ₹1,299/year', '₹1,299/year')).toBe('QuickCred Shield');
    expect(cleanLabel('Convenience fee: ₹49', '₹49')).toBe('Convenience fee');
  });
});

describe('labels', () => {
  it('resolve in priority order', () => {
    loadHtml(`
      <label for="a">For label</label><input id="a" aria-label="aria A">
      <label>Wrapping label <input id="b" aria-label="aria B"></label>
      <input id="c" aria-label="Aria label" placeholder="ph C">
      <span id="lbl">Labelled by</span><input id="d" aria-labelledby="lbl" placeholder="ph D">
      <input id="e" placeholder="Placeholder label">
      <div><span>Preceding text</span><input id="f"></div>
    `);
    const { reader } = newReader();
    const labels = reader.read(1).snapshot.fields.map((f) => f.label);
    expect(labels).toEqual([
      'For label',
      'Wrapping label',
      'Aria label',
      'Labelled by',
      'Placeholder label',
      'Preceding text',
    ]);
  });

  it('take help text from aria-describedby, then small text right after the field', () => {
    loadHtml(`
      <label for="a">PAN</label><input id="a" aria-describedby="h"><p id="h">10 characters</p>
      <label for="b">IFSC</label><input id="b"><small>Printed on your cheque book</small>
      <label for="c">CKYC</label><input id="c"><p>Next paragraph of the page</p>
    `);
    const { reader } = newReader();
    const help = reader.read(1).snapshot.fields.map((f) => f.help_text);
    expect(help).toEqual(['10 characters', 'Printed on your cheque book', null]);
  });

  it('use the fieldset legend, then the heading before the field, as the section', () => {
    loadHtml(`
      <h2>Bank details</h2><label for="a">IFSC</label><input id="a">
      <fieldset><legend>Nominee</legend><label for="b">Name</label><input id="b"></fieldset>
    `);
    const { reader } = newReader();
    expect(reader.read(1).snapshot.fields.map((f) => f.section)).toEqual([
      'Bank details',
      'Nominee',
    ]);
  });
});

describe('sections', () => {
  it('start at each h1–h4 and hold the text up to the next heading', () => {
    loadHtml(`
      <h1>Title</h1><p>Intro.</p>
      <h2>7 Cancellation</h2><h3>7.2 Cancellation</h3><p>You may cancel with notice.</p>
      <h5>Small heading</h5><p>Still in 7.2.</p>
    `);
    const { reader } = newReader();
    const sections = reader.read(1).snapshot.sections;
    expect(sections.map((s) => [s.heading, s.level, s.text])).toEqual([
      ['Title', 1, 'Intro.'],
      ['7.2 Cancellation', 3, 'You may cancel with notice. Small heading Still in 7.2.'],
    ]);
  });

  it('split long sections into parts with " (cont.)" and stable IDs', () => {
    const sentence = 'This clause keeps going with more words. ';
    loadHtml(`<h2>Long</h2><p>${sentence.repeat(250)}</p>`);
    const { reader } = newReader();
    const first = reader.read(1).snapshot.sections;
    expect(first.length).toBeGreaterThan(2);
    expect(first.every((s) => s.text.length <= LIMITS.sectionChars)).toBe(true);
    expect(first[0]?.heading).toBe('Long');
    expect(first[1]?.heading).toBe('Long (cont.)');
    expect(reader.read(2).snapshot.sections.map((s) => s.id)).toEqual(first.map((s) => s.id));
  });

  it('group unheaded text into sections of about 800 characters', () => {
    const para = `<p>${'Plain words without any heading at all. '.repeat(10)}</p>`;
    loadHtml(para.repeat(6));
    const { reader } = newReader();
    const sections = reader.read(1).snapshot.sections;
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((s) => s.heading === null)).toBe(true);
  });

  it("skip Iris's own elements and hidden content", () => {
    loadHtml(`
      <h1>Page</h1><p>Visible text.</p>
      <p hidden>Hidden text.</p><p aria-hidden="true">Aria hidden.</p>
      <details><summary>Summary text</summary><p>Closed details text.</p></details>
      <iris-widget><p>Iris panel text</p><input id="x"></iris-widget>
      <iris-overlay><p>Overlay text</p></iris-overlay>
    `);
    const { reader } = newReader();
    const snapshot = reader.read(1).snapshot;
    const json = JSON.stringify(snapshot);
    expect(snapshot.sections[0]?.text).toBe('Visible text. Summary text');
    for (const hidden of [
      'Hidden text',
      'Aria hidden',
      'Closed details',
      'Iris panel',
      'Overlay text',
    ]) {
      expect(json).not.toContain(hidden);
    }
    expect(snapshot.fields).toHaveLength(0);
  });
});

describe('prices', () => {
  it('take the label from the row, a table header or a dt, and skip prose', () => {
    loadHtml(`
      <div class="row"><span>Nimbus 14 laptop</span> <span>₹59,999</span></div>
      <table><tr><th>Processing fee</th><td>₹1,416 (2% + GST), deducted upfront</td></tr></table>
      <dl><dt>Monthly instalment</dt><dd>₹5,900/month</dd></dl>
      <p>${'This long paragraph of legal prose mentions a late fee of ₹500 per missed instalment and goes on and on. '.repeat(2)}</p>
      <button>Pay ₹1,348 with UPI</button>
    `);
    const { reader } = newReader();
    const prices = reader.read(1).snapshot.prices;
    expect(prices.map((p) => [p.label, p.amount_text, p.amount_inr])).toEqual([
      ['Nimbus 14 laptop', '₹59,999', 59999],
      ['Processing fee', '₹1,416', 1416],
      ['Monthly instalment', '₹5,900/month', 5900],
    ]);
  });
});

describe('limits', () => {
  it('stop at 150 fields and set truncated', () => {
    loadHtml(
      Array.from(
        { length: 160 },
        (_, i) => `<label for="f${i}">Field ${i}</label><input id="f${i}">`,
      ).join(''),
    );
    const { reader } = newReader();
    const snapshot = reader.read(1).snapshot;
    expect(snapshot.fields).toHaveLength(LIMITS.fields);
    expect(snapshot.truncated).toBe(true);
  });
});

describe('buttons, links and the cookie banner', () => {
  it('lists buttons with their kind, legal links and a banner with a hidden reject option', () => {
    loadHtml(`
      <style>.banner { position: fixed; bottom: 0; }</style>
      <form><button type="submit">Submit application</button></form>
      <button type="button">Send OTP</button>
      <a href="/terms">Terms and Conditions</a>
      <div class="banner"><p>We use cookies.</p><button>Accept all</button><button>Manage choices</button>
        <div hidden><button>Reject all</button></div></div>
    `);
    const { reader } = newReader();
    const snapshot = snapshotOf(reader).snapshot;
    expect(snapshot.buttons.map((b) => [b.text, b.kind])).toEqual([
      ['Submit application', 'submit'],
      ['Send OTP', 'button'],
      ['Accept all', 'button'],
      ['Manage choices', 'button'],
    ]);
    expect(snapshot.legal_links.map((l) => l.text)).toEqual(['Terms and Conditions']);
    const banner = snapshot.cookie_banner;
    expect(banner).toMatchObject({ reject_button_id: null, reject_visible: false });
    expect(banner?.accept_button_id).toBe(snapshot.buttons[2]?.id);
    expect(banner?.manage_button_id).toBe(snapshot.buttons[3]?.id);
  });
});

describe('IDs', () => {
  it('stay the same across reads and never touch the page', () => {
    loadHtml('<h2>Section</h2><label for="a">Name</label><input id="a"><p>₹499 fee</p>');
    const before = document.body.innerHTML;
    const { reader } = newReader();
    const first = reader.read(1).snapshot;
    const second = reader.read(2).snapshot;
    expect(second.fields[0]?.id).toBe(first.fields[0]?.id);
    expect(second.sections[0]?.id).toBe(first.sections[0]?.id);
    expect(document.body.innerHTML).toBe(before);
  });
});
