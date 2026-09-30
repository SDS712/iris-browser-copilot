import { describe, expect, it, vi } from 'vitest';
import { createStore } from '../../src/core/store';
import {
  BATCH,
  fallbackSay,
  FOLLOW_DELAY_MS,
  FOLLOWED,
  formStops,
  spokenHeading,
  Tour,
  TOUR_LINES,
  tourCommand,
  tourStops,
} from '../../src/core/tour';
import { MockVoiceSession } from '../../src/core/mock-session';
import type { ToolCallEvent } from '../../src/core/protocol';
import { fakeAdapter, fakeApi, snapshot } from './fakes';

const LONG = 'You can cancel with 30 days notice. A fee of ₹499 applies in the first six months.';

function sections(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `s-${String(i + 1)}`,
    heading: `${String(i + 1)} Part ${String(i + 1)}`,
    level: 2,
    text: `${LONG} (part ${String(i + 1)})`,
  }));
}

function setup(count = 12) {
  const store = createStore();
  store.page.value = {
    page_id: 'pg_1',
    page_type: 'terms',
    url: 'https://shop.example/terms',
    summary_for_agent: 'PAGE: Terms',
    truncated: false,
    scan: null,
  };
  const page = fakeAdapter();
  const api = fakeApi();
  const snap = snapshot({ sections: sections(count) });
  const tour = new Tour({ api, store, adapter: page.adapter, snapshot: () => snap });
  return { store, page, api, tour };
}

describe('the walkthrough’s stops', () => {
  it('keep every section in order, but not empty ones, chrome or split-off parts', () => {
    const snap = snapshot({
      sections: [
        { id: 's-1', heading: '1 Fees', level: 2, text: LONG },
        { id: 's-2', heading: '1 Fees (cont.)', level: 2, text: LONG },
        { id: 's-3', heading: null, level: null, text: 'Home › Terms' },
        { id: 's-4', heading: '2 Empty', level: 2, text: '  ' },
        { id: 's-5', heading: null, level: null, text: LONG },
      ],
    });
    expect(tourStops(snap).map((stop) => stop.key)).toEqual(['s-1', 's-5']);
  });

  it('say headings without their numbers, and fall back to a first sentence', () => {
    expect(spokenHeading('7.2 Cancellation')).toBe('Cancellation');
    expect(spokenHeading('Fees')).toBe('Fees');
    expect(spokenHeading(null)).toBeNull();
    expect(fallbackSay(LONG)).toBe('You can cancel with 30 days notice.');
  });
});

describe('walkthrough commands', () => {
  it('are single words or short phrases, not questions', () => {
    expect(tourCommand('Next.')).toBe('next');
    expect(tourCommand('go back')).toBe('back');
    expect(tourCommand('again')).toBe('repeat');
    expect(tourCommand('Stop!')).toBe('stop');
    expect(tourCommand('what comes next?')).toBeNull();
  });
});

describe('walking through', () => {
  it('starts at the top, then next, back, repeat and stop', async () => {
    const { store, page, tour } = setup();
    const first = await tour.act('start');
    expect(first).toMatchObject({ step: 1, total: 12 });
    expect(first.say).toBe(`${TOUR_LINES.intro(12)} Step 1 of 12. Part 1. About s-1.`);
    expect(page.adapter.highlight).toHaveBeenLastCalledWith({ ids: ['s-1'], level: 'normal' });
    expect((await tour.act('next')).say).toBe('Step 2 of 12. Part 2. About s-2.');
    expect((await tour.act('back')).step).toBe(1);
    expect((await tour.act('back')).step).toBe(1);
    expect((await tour.act('repeat')).step).toBe(1);
    expect(store.tour.value).toMatchObject({ index: 0, total: 12, key: 's-1' });
    expect((await tour.act('stop')).say).toBe(TOUR_LINES.stopped);
    expect(store.tour.value).toBeNull();
    expect(page.adapter.clearHighlights).toHaveBeenCalled();
  });

  it('ends after the last part', async () => {
    const { store, tour } = setup(2);
    await tour.act('start');
    await tour.act('next');
    expect((await tour.act('next')).say).toBe(TOUR_LINES.done);
    expect(store.tour.value).toBeNull();
  });

  it('asks for explanations 5 at a time, fetching the next batch just ahead', async () => {
    const { api, tour } = setup(12);
    await tour.act('start');
    expect(api.walkthrough).toHaveBeenCalledTimes(1);
    expect(api.walkthrough).toHaveBeenLastCalledWith('pg_1', {
      section_ids: ['s-1', 's-2', 's-3', 's-4', 's-5'],
    });
    await tour.act('next'); // stop 2: 3 explained ahead, no fetch yet
    expect(api.walkthrough).toHaveBeenCalledTimes(1);
    await tour.act('next'); // stop 3: only 2 left ahead, so the next batch is fetched
    await vi.waitFor(() => {
      expect(api.walkthrough).toHaveBeenCalledTimes(2);
    });
    expect(api.walkthrough).toHaveBeenLastCalledWith('pg_1', {
      section_ids: ['s-6', 's-7', 's-8', 's-9', 's-10'].slice(0, BATCH),
    });
  });

  it('falls back to the first sentence when the explanations fail', async () => {
    const { api, tour } = setup(3);
    api.walkthrough.mockRejectedValue(new Error('down'));
    const first = await tour.act('start');
    expect(first.say).toContain('Step 1 of 3. Part 1. You can cancel with 30 days notice.');
  });

  it('says so when there is nothing to walk through, or no walkthrough running', async () => {
    const empty = setup(0);
    expect((await empty.tour.act('start')).say).toBe(TOUR_LINES.nothing);
    expect((await empty.tour.act('next')).say).toBe(TOUR_LINES.notRunning);
  });

  it('ends quietly on navigation', async () => {
    const { store, tour } = setup();
    await tour.act('start');
    tour.end();
    expect(store.tour.value).toBeNull();
  });
});

describe('mock voice drives the walkthrough', () => {
  it('sends walkthrough words to walk_through, and anything else to ask_page', async () => {
    vi.useFakeTimers();
    const store = createStore();
    const hooks = {
      onReady: vi.fn(),
      onResumed: vi.fn(),
      onToolCall: vi.fn<(call: ToolCallEvent) => void>(),
      onUserFinal: vi.fn(),
      onEnded: vi.fn(),
    };
    const session = new MockVoiceSession({ store, hooks });
    void session.start({ greet: false });
    await vi.advanceTimersByTimeAsync(400);
    for (const text of [
      'Walk me through this page',
      'next',
      'Again.',
      'stop',
      'What is NACH?',
      'Can you guide me in filling this form?',
    ]) {
      session.sendUserText(text);
    }
    expect(hooks.onToolCall.mock.calls.map(([call]) => [call.name, call.arguments])).toEqual([
      ['walk_through', { action: 'start' }],
      ['walk_through', { action: 'next' }],
      ['walk_through', { action: 'repeat' }],
      ['walk_through', { action: 'stop' }],
      ['ask_page', { question: 'What is NACH?' }],
      ['walk_through', { action: 'start', mode: 'form' }],
    ]);
    session.endNow();
    vi.useRealTimers();
  });
});

// --- Forms ---

const field = (id: string, label: string, section: string | null) => ({
  id,
  label,
  type: 'text' as const,
  required: true,
  placeholder: null,
  help_text: null,
  section,
  options: [],
  filled: false,
  sensitive: false,
});

const box = (
  id: string,
  label: string,
  kind: 'checkbox' | 'radio' = 'checkbox',
  group: string | null = null,
) => ({
  id,
  label,
  kind,
  group,
  checked: false,
  prechecked: false,
  amount_inr: null,
  first_seen_revision: 1,
});

const APPLY = snapshot({
  page_type_hint: 'form',
  fields: [
    field('i-10', 'Full name', 'About you'),
    field('i-11', 'PAN', 'About you'),
    field('i-14', 'Account number', 'Bank details'),
    field('i-15', 'IFSC code', 'Bank details'),
    field('i-18', 'OTP', 'Verify'),
  ],
  checkboxes: [box('i-19', 'Send me offers'), box('i-20', 'I agree to the Terms')],
});

function formSetup(snap = APPLY, pageType: 'form' | 'checkout' = 'form') {
  vi.useFakeTimers();
  const setupResult = setup(0);
  const current = setupResult.store.page.value;
  if (current) setupResult.store.page.value = { ...current, page_type: pageType };
  const session = { isRunning: true, createReply: vi.fn() };
  const tour = new Tour({
    api: setupResult.api,
    store: setupResult.store,
    adapter: setupResult.page.adapter,
    snapshot: () => snap,
    session: () => session as never,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  setupResult.store.session.state.value = 'listening';
  return { ...setupResult, tour, session };
}

describe('a form walkthrough’s steps', () => {
  it('are the form’s parts when it has several, with checkboxes where they appear', () => {
    expect(formStops(APPLY).map((stop) => [stop.heading, stop.ids])).toEqual([
      ['About you', ['i-10', 'i-11']],
      ['Bank details', ['i-14', 'i-15']],
      ['Verify', ['i-18']],
      ['Checkboxes', ['i-19', 'i-20']],
    ]);
  });

  it('are the fields when there is one part, with a radio group as one step', () => {
    const one = snapshot({
      fields: [field('i-1', 'Email', 'Sign up'), field('i-2', 'Password', 'Sign up')],
      checkboxes: [box('i-3', 'Monthly', 'radio', 'Plan'), box('i-4', 'Yearly', 'radio', 'Plan')],
    });
    expect(formStops(one).map((stop) => [stop.heading, stop.ids])).toEqual([
      ['Email', ['i-1']],
      ['Password', ['i-2']],
      ['Plan', ['i-3', 'i-4']],
    ]);
  });
});

describe('guiding the user through a form', () => {
  it('starts a form walkthrough on a form page, asking for the parts to be explained', async () => {
    const { api, page, tour } = formSetup();
    const first = await tour.act('start');
    expect(tour.mode).toBe('form');
    expect(first.say).toBe(
      `${TOUR_LINES.formIntro(4, false)} Step 1 of 4. About you. About part-1.`,
    );
    expect(api.walkthrough).toHaveBeenLastCalledWith('pg_1', {
      form_steps: [
        { key: 'part-1', heading: 'About you', element_ids: ['i-10', 'i-11'] },
        { key: 'part-2', heading: 'Bank details', element_ids: ['i-14', 'i-15'] },
        { key: 'part-3', heading: 'Verify', element_ids: ['i-18'] },
        { key: 'part-4', heading: 'Checkboxes', element_ids: ['i-19', 'i-20'] },
      ],
    });
    expect(page.adapter.highlight).toHaveBeenLastCalledWith({
      ids: ['i-10', 'i-11'],
      level: 'normal',
    });
    await tour.act('next');
    await tour.act('next');
    await tour.act('next');
    expect((await tour.act('next')).say).toBe(TOUR_LINES.formDone);
    vi.useRealTimers();
  });

  it('keeps the page walkthrough elsewhere, and for a page with nothing to fill in', async () => {
    const other = formSetup(snapshot({ sections: sections(3) }), 'checkout');
    await other.tour.act('start');
    expect(other.tour.mode).toBe('page');
    const asked = formSetup(snapshot({ sections: sections(3), fields: [] }));
    await asked.tour.act('start', 'form');
    expect(asked.tour.mode).toBe('page');
    vi.useRealTimers();
  });

  it('follows a click into another part once the focus stays put, and says it', async () => {
    const { store, session, tour } = formSetup();
    await tour.act('start');
    tour.onControlFocus('i-14');
    tour.onControlFocus('i-18'); // tabbing on: only where the focus settles counts
    await vi.advanceTimersByTimeAsync(FOLLOW_DELAY_MS - 1);
    expect(store.tour.value?.index).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.tour.value?.index).toBe(2);
    expect(session.createReply).toHaveBeenCalledWith(
      `${FOLLOWED} Tell the user this now, keeping the meaning and every figure exactly: "Step 3 of 4. Verify. About part-3."`,
    );
    // A click inside the current part changes nothing.
    tour.onControlFocus('i-18');
    await vi.advanceTimersByTimeAsync(FOLLOW_DELAY_MS);
    expect(session.createReply).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('waits for Iris to finish speaking before saying the new part', async () => {
    const { store, session, tour } = formSetup();
    await tour.act('start');
    store.session.state.value = 'speaking';
    tour.onControlFocus('i-14');
    await vi.advanceTimersByTimeAsync(FOLLOW_DELAY_MS + 2_000);
    expect(store.tour.value?.index).toBe(1);
    expect(session.createReply).not.toHaveBeenCalled();
    store.session.state.value = 'listening';
    await vi.advanceTimersByTimeAsync(300);
    expect(session.createReply).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('never follows clicks during a page walkthrough', async () => {
    const { store, tour } = formSetup(
      snapshot({ sections: sections(3), fields: APPLY.fields }),
      'checkout',
    );
    await tour.act('start');
    tour.onControlFocus('i-14');
    await vi.advanceTimersByTimeAsync(FOLLOW_DELAY_MS * 2);
    expect(store.tour.value?.index).toBe(0);
    vi.useRealTimers();
  });
});
