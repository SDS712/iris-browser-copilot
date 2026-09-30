import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLEARED_WINDOW_MS, HesitationDetector, LINGER_MS } from '../../../src/page/hesitation';
import { loadHtml } from './helpers';

let now = 0;

function setup() {
  loadHtml('<label for="a">CKYC</label><input id="a"><label for="b">Other</label><input id="b">');
  const onHesitation = vi.fn();
  const detector = new HesitationDetector({
    fieldId: (el) => (el.id === 'a' ? 'i-1' : el.id === 'b' ? 'i-2' : null),
    onHesitation,
    now: () => now,
  });
  detector.start();
  const input = document.getElementById('a') as HTMLInputElement;
  return { detector, onHesitation, input };
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  now = 0;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('hesitation', () => {
  it('fires after 9 s in an empty field with no typing', () => {
    const { onHesitation, input, detector } = setup();
    input.focus();
    vi.advanceTimersByTime(LINGER_MS - 1);
    expect(onHesitation).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onHesitation).toHaveBeenCalledWith('i-1');
    detector.stop();
  });

  it('resets on typing, and never fires for a filled field or after leaving it', () => {
    const { onHesitation, input, detector } = setup();
    input.focus();
    vi.advanceTimersByTime(5_000);
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    vi.advanceTimersByTime(5_000);
    expect(onHesitation).not.toHaveBeenCalled();
    type(input, 'ABC');
    vi.advanceTimersByTime(LINGER_MS);
    expect(onHesitation).not.toHaveBeenCalled();
    type(input, '');
    input.blur();
    vi.advanceTimersByTime(LINGER_MS);
    expect(onHesitation).not.toHaveBeenCalled();
    detector.stop();
  });

  it('fires when the same field is cleared twice within 60 s', () => {
    const { onHesitation, input, detector } = setup();
    input.focus();
    type(input, 'A');
    type(input, '');
    now += 10_000;
    type(input, 'B');
    type(input, '');
    expect(onHesitation).toHaveBeenCalledWith('i-1');
    onHesitation.mockClear();
    now += CLEARED_WINDOW_MS + 1;
    type(input, 'C');
    type(input, '');
    expect(onHesitation).not.toHaveBeenCalled();
    detector.stop();
  });
});
