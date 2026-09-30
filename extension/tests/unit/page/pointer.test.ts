import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layout, Rect } from '../../../src/page/layout';
import type { PointerHint } from '../../../src/core/api';
import {
  DWELL_MS,
  NEAREST_FIELD_PX,
  PointerTracker,
  REST_MS,
  type PointerTargets,
} from '../../../src/page/pointer';
import { PageRuntime } from '../../../src/page/runtime';
import { loadHtml, testLayout } from './helpers';

/** Far from both fields unless a test says otherwise. */
function move(el: Element, x = 400, y = 10): void {
  el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
}

describe('pointer tracker', () => {
  const rects = new Map<Element, Rect>();
  const layout: Layout = {
    ...testLayout,
    rect: (el) => rects.get(el) ?? { x: 0, y: 0, width: 0, height: 0 },
  };
  let tracker: PointerTracker;
  let dwells: PointerHint[];
  let el: (id: string) => HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <p id="clause">A long clause.</p>
      <label for="pan">PAN</label><input id="pan">
      <input id="ifsc">
      <p id="margin">Nothing here.</p>
      <iris-widget id="widget"><button id="ask">Ask</button></iris-widget>`;
    el = (id) => document.getElementById(id) as HTMLElement;
    rects.clear();
    rects.set(el('pan'), { x: 0, y: 100, width: 200, height: 30 });
    rects.set(el('ifsc'), { x: 0, y: 400, width: 200, height: 30 });
    const ids = new Map<Element, string>([
      [el('pan'), 'i-1'],
      [el('ifsc'), 'i-2'],
    ]);
    const targets: PointerTargets = {
      field: (target) => ids.get(target.closest('label')?.control ?? target) ?? null,
      price: () => null,
      section: (target) => (target.id === 'clause' ? 's-1' : null),
      fields: () => [...ids].map(([element, id]) => ({ id, element })),
    };
    dwells = [];
    tracker = new PointerTracker({ layout, targets, onDwell: (hint) => dwells.push(hint) });
    tracker.start();
  });

  afterEach(() => {
    tracker.stop();
    vi.useRealTimers();
  });

  it('counts what the mouse rests on for half a second', () => {
    move(el('clause'));
    vi.advanceTimersByTime(REST_MS - 1);
    expect(tracker.current()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(tracker.current()).toEqual({ field_id: null, price_id: null, section_id: 's-1' });
  });

  it('passing over something on the way elsewhere does not count', () => {
    move(el('clause'), 10, 10);
    vi.advanceTimersByTime(200);
    move(el('pan'), 50, 110);
    vi.advanceTimersByTime(REST_MS);
    expect(tracker.current()?.field_id).toBe('i-1');
    expect(tracker.current()?.section_id).toBeNull();
  });

  it('a field label points at its field', () => {
    move(document.querySelector('label') as Element, 5, 90);
    vi.advanceTimersByTime(REST_MS);
    expect(tracker.current()?.field_id).toBe('i-1');
  });

  it(`takes the nearest field within ${String(NEAREST_FIELD_PX)} px, and none further away`, () => {
    move(el('margin'), 100, 180);
    vi.advanceTimersByTime(REST_MS);
    expect(tracker.current()?.field_id).toBe('i-1');
    tracker.reset();
    move(el('margin'), 100, 260);
    vi.advanceTimersByTime(REST_MS);
    expect(tracker.current()).toBeNull();
  });

  it('the most recent of a mouse rest and a focused field wins', () => {
    move(el('clause'));
    vi.advanceTimersByTime(REST_MS);
    el('ifsc').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(tracker.current()?.field_id).toBe('i-2');
    move(el('clause'), 440, 40);
    vi.advanceTimersByTime(REST_MS);
    expect(tracker.current()).toEqual({ field_id: null, price_id: null, section_id: 's-1' });
  });

  it('a click points at once', () => {
    el('pan').dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 110 }),
    );
    expect(tracker.current()?.field_id).toBe('i-1');
  });

  it('keeps the last thing when the mouse leaves the page for the side panel', () => {
    move(el('pan'), 50, 110);
    vi.advanceTimersByTime(REST_MS);
    move(el('clause'), 300, 10);
    document.body.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null }));
    vi.advanceTimersByTime(REST_MS);
    expect(tracker.current()?.field_id).toBe('i-1');
  });

  it(`reports a ${String(DWELL_MS)} ms rest on a clause, not a shorter one`, () => {
    move(el('clause'));
    vi.advanceTimersByTime(DWELL_MS - 1);
    expect(dwells).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(dwells).toEqual([{ field_id: null, price_id: null, section_id: 's-1' }]);
  });

  it('reports no dwell on a field, or once the mouse moved on', () => {
    move(el('pan'), 50, 110);
    vi.advanceTimersByTime(DWELL_MS);
    move(el('clause'));
    vi.advanceTimersByTime(DWELL_MS - 100);
    move(el('margin'), 100, 260);
    vi.advanceTimersByTime(DWELL_MS);
    expect(dwells).toEqual([]);
  });

  it("ignores Iris's own widget", () => {
    move(el('pan'), 50, 110);
    vi.advanceTimersByTime(REST_MS);
    move(el('ask'), 600, 600);
    vi.advanceTimersByTime(REST_MS);
    el('ask').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(tracker.current()?.field_id).toBe('i-1');
  });
});

describe('what the page runtime says the user points at', () => {
  let runtime: PageRuntime;

  beforeEach(async () => {
    loadHtml(`<body>
      <h2 id="fees">Fees</h2>
      <p id="clause">A late fee applies when an instalment is paid after its due date. It is charged
        once for each missed instalment and is added to your next instalment, as set out in
        the schedule of charges that forms part of this agreement.</p>
      <div id="row"><span id="label">Convenience fee</span> <span id="amount">₹49</span></div>
      <h2>Your details</h2>
      <label for="pan">PAN</label><input id="pan" name="pan" type="text">
    </body>`);
    runtime = new PageRuntime({ layout: testLayout, sleep: () => Promise.resolve() });
    await runtime.getSnapshot();
    runtime.start();
  });

  afterEach(() => {
    runtime.destroy();
  });

  function clickOn(id: string) {
    const target = document.getElementById(id) as Element;
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }));
    return runtime.pointerHint();
  }

  it('finds the section of a clause, the price in a short row and a labelled field', async () => {
    const snapshot = await runtime.getSnapshot();
    const fees = snapshot.sections.find((s) => s.heading === 'Fees')?.id;
    const details = snapshot.sections.find((s) => s.heading === 'Your details')?.id;
    const price = snapshot.prices.find((p) => p.amount_text === '₹49')?.id;
    const field = snapshot.fields.find((f) => f.label === 'PAN')?.id;
    expect([fees, details, price, field].every(Boolean)).toBe(true);

    expect(clickOn('clause')).toMatchObject({ price_id: null, section_id: fees });
    expect(clickOn('label')).toMatchObject({ price_id: price, section_id: fees });
    expect(clickOn('pan')).toMatchObject({ field_id: field, section_id: details });
  });

  it('tells core when a field it has read gets focus, by ID only', async () => {
    const events: unknown[] = [];
    runtime.onPageEvent((event) => events.push(event));
    const field = (await runtime.getSnapshot()).fields.find((f) => f.label === 'PAN')?.id;
    document.getElementById('pan')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    document.getElementById('clause')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(events.filter((e) => (e as { type: string }).type === 'control-focus')).toEqual([
      { type: 'control-focus', element_id: field },
    ]);
  });

  it('forgets an element that has left the page', () => {
    clickOn('clause');
    document.getElementById('fees')?.remove();
    document.getElementById('clause')?.remove();
    expect(runtime.pointerHint()?.section_id ?? null).toBeNull();
  });
});
