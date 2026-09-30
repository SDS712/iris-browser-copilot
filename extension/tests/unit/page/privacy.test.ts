import { afterEach, describe, expect, it } from 'vitest';
import { isSensitive } from '../../../src/page/privacy';
import { loadFixture, loadHtml, newReader, snapshotOf } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

function type(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('privacy', () => {
  it('never puts a typed value anywhere in the snapshot, for every kind of field', () => {
    loadFixture('form.html');
    const typed: string[] = [];
    document.querySelectorAll('input').forEach((input, index) => {
      if (input.type === 'checkbox' || input.type === 'radio') return;
      const value =
        input.type === 'date' ? '1990-01-0' + String(index % 9) : `SECRET${index}X${index * 7}`;
      type(input, value);
      typed.push(value);
    });
    const select = document.querySelector('select');
    if (select) select.selectedIndex = 2;
    const { reader } = newReader();
    const snapshot = snapshotOf(reader).snapshot;
    const json = JSON.stringify(snapshot);
    for (const value of typed) expect(json).not.toContain(value);
    expect(json).not.toMatch(/"value"\s*:/);
    expect(snapshot.fields.every((field) => field.filled)).toBe(true);
  });

  it('marks sensitive fields and never sends their placeholder', () => {
    loadFixture('form.html');
    const { reader } = newReader();
    const fields = snapshotOf(reader).snapshot.fields;
    const byLabel = new Map(fields.map((f) => [f.label, f]));
    for (const label of ['OTP', 'Bank account number', 'Debit card number', 'Create a password']) {
      expect(byLabel.get(label)).toMatchObject({ sensitive: true, placeholder: null });
    }
    expect(byLabel.get('PAN')).toMatchObject({ sensitive: false, placeholder: 'ABCDE1234F' });
    expect(byLabel.get('IFSC')).toMatchObject({
      sensitive: false,
      placeholder: 'e.g. ABCD0123456',
    });
    expect(JSON.stringify(fields)).not.toContain('XXXX XXXX 4321');
  });

  it('follows the sensitive-field table', () => {
    const cases: [string, string, boolean][] = [
      ['<input type="password">', '', true],
      ['<input autocomplete="cc-number">', '', true],
      ['<input autocomplete="cc-csc">', '', true],
      ['<input autocomplete="cc-exp">', '', true],
      ['<input autocomplete="one-time-code">', '', true],
      ['<input autocomplete="current-password">', '', true],
      ['<input autocomplete="new-password">', '', true],
      ['<input>', 'Passcode', true],
      ['<input>', 'Enter OTP', true],
      ['<input>', 'One-time code', true],
      ['<input>', 'PIN', true],
      ['<input>', 'CVV', true],
      ['<input>', 'Card number', true],
      ['<input>', 'Account no.', true],
      ['<input>', 'Aadhaar', true],
      ['<input>', 'UPI PIN', true],
      ['<input name="acct_number">', '', false],
      ['<input name="account_number">', '', true],
      ['<input id="upi-pin">', '', true],
      ['<input>', 'Full name', false],
      ['<input>', 'Pincode area', false],
      ['<input>', 'IFSC', false],
    ];
    for (const [html, label, expected] of cases) {
      loadHtml(html);
      const input = document.querySelector('input');
      if (!input) throw new Error('no input');
      expect([html, label, isSensitive(input, label)]).toEqual([html, label, expected]);
    }
  });

  it('reports whether a field is filled without its value', () => {
    loadHtml(
      '<label for="a">A</label><input id="a"><label for="b">B</label><textarea id="b"></textarea>',
    );
    const input = document.querySelector('input');
    if (input) type(input, 'hello');
    const { reader } = newReader();
    expect(snapshotOf(reader).snapshot.fields.map((f) => f.filled)).toEqual([true, false]);
  });
});
