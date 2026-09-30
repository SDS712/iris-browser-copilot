import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Nudge, PageType, ScanResult } from '../../src/core/api';
import {
  chipForPageEvent,
  chipForRisks,
  isStopSuggesting,
  LATE_PRICE_COOLDOWN_MS,
  NUDGE_COOLDOWN_MS,
  NudgeEngine,
  READ_TERMS_LINE,
  risksChipLabel,
} from '../../src/core/nudges';
import { createStore } from '../../src/core/store';
import { fakeAdapter, fakeSession, scanResult, snapshot } from './fakes';

function risk(id: string, key: string, severity: 'high' | 'medium' | 'info' = 'high') {
  return {
    id,
    key,
    category: 'costs_money' as const,
    severity,
    title: `Risk ${id}`,
    detail: 'Detail.',
    quote: null,
    section_id: null,
    element_ids: [`i-${id}`],
    amount_inr: null,
    origin: 'client_rule' as const,
  };
}

function nudgeFor(
  ids: string[],
  keys: string[],
  say = 'Before you pay: something. Want the details?',
): Nudge {
  return { say, risk_ids: ids, risk_keys: keys, highlight_ids: ids.map((id) => `i-${id}`) };
}

function scanWith(
  nudge: Nudge | null,
  risks = [risk('1', 'client_rule:prechecked_paid_addon:i-1')],
  pageId = 'pg_1',
): ScanResult {
  return {
    ...scanResult('ready', pageId),
    risks,
    nudge,
    counts: { high: risks.length, medium: 0, info: 0 },
  };
}

function setup(options: { running?: boolean; pageType?: PageType } = {}) {
  const store = createStore();
  store.page.value = {
    page_id: 'pg_1',
    page_type: options.pageType ?? 'checkout',
    url: 'https://example.com/checkout',
    summary_for_agent: '',
    truncated: false,
    scan: null,
  };
  const page = fakeAdapter(
    snapshot({
      client_flags: [
        {
          rule: 'prechecked_paid_addon',
          category: 'costs_money',
          severity: 'high',
          element_ids: ['i-20'],
          detail: 'x',
          amount_inr: 1299,
          params: {},
        },
      ],
      cookie_banner: {
        id: 'i-9',
        accept_button_id: 'i-10',
        reject_button_id: null,
        manage_button_id: 'i-11',
        reject_visible: false,
      },
      buttons: [{ id: 'i-11', text: 'Manage choices', kind: 'button', disabled: false }],
    }),
  );
  const session = fakeSession(options.running ?? true);
  const actions = {
    openIris: vi.fn(),
    explainField: vi.fn(() => Promise.resolve()),
    showRisks: vi.fn(),
    showTrust: vi.fn(),
    explainHere: vi.fn(() => Promise.resolve()),
    cardForNudge: vi.fn(() => Promise.resolve()),
  };
  store.session.state.value = 'listening';
  const engine = new NudgeEngine({ store, adapter: page.adapter, session: () => session, actions });
  engine.start();
  return { store, page, session, actions, engine };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('spoken nudges', () => {
  it('speak when a session is listening: reply.create with the context, then risk rings', async () => {
    const { session, page, engine, actions } = setup();
    const nudge = nudgeFor(['1'], ['client_rule:prechecked_paid_addon:i-1']);
    engine.onScan(scanWith(nudge));
    await vi.runAllTimersAsync();
    expect(session.createReply).toHaveBeenCalledWith(
      `NUDGE CONTEXT: Risk 1 (i-1)\nTell the user this now, keeping the meaning and every figure exactly: "${nudge.say}"`,
    );
    expect(actions.cardForNudge).toHaveBeenCalledWith('checkout', nudge);
    expect(page.adapter.highlight).toHaveBeenCalledWith({ ids: ['i-1'], level: 'risk' });
    expect(engine.excludeKeys()).toEqual(['client_rule:prechecked_paid_addon:i-1']);
  });

  it('wait for listening (up to 10 s) and never talk over anyone', async () => {
    const { store, session, engine } = setup();
    store.session.state.value = 'speaking';
    engine.onScan(scanWith(nudgeFor(['1'], ['k1'])));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(session.createReply).not.toHaveBeenCalled();
    store.session.state.value = 'listening';
    await vi.advanceTimersByTimeAsync(300);
    expect(session.createReply).toHaveBeenCalledTimes(1);
  });

  it('give up if Iris is never listening within 10 s', async () => {
    const { store, session, engine } = setup();
    store.session.state.value = 'hearing';
    engine.onScan(scanWith(nudgeFor(['1'], ['k1'])));
    await vi.advanceTimersByTimeAsync(11_000);
    store.session.state.value = 'listening';
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.createReply).not.toHaveBeenCalled();
  });

  it('keep 60 s between nudges, never repeat a risk, and let a late fee in after 20 s', async () => {
    const { session, engine } = setup();
    engine.onScan(scanWith(nudgeFor(['1'], ['k1'])));
    await vi.advanceTimersByTimeAsync(10);
    expect(session.createReply).toHaveBeenCalledTimes(1);
    engine.onScan(scanWith(nudgeFor(['1'], ['k1'])));
    await vi.advanceTimersByTimeAsync(NUDGE_COOLDOWN_MS + 1_000);
    expect(session.createReply).toHaveBeenCalledTimes(1);

    const late = nudgeFor(['2'], ['client_rule:late_price:i-35']);
    engine.onScan(scanWith(late));
    await vi.advanceTimersByTimeAsync(10);
    expect(session.createReply).toHaveBeenCalledTimes(2);
    engine.onScan(scanWith(nudgeFor(['3'], ['page_text:auto_debit:s-4'])));
    await vi.advanceTimersByTimeAsync(LATE_PRICE_COOLDOWN_MS);
    expect(session.createReply).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(NUDGE_COOLDOWN_MS - LATE_PRICE_COOLDOWN_MS + 500);
    expect(session.createReply).toHaveBeenCalledTimes(3);
  });

  it('start again in a new document', async () => {
    const { session, engine } = setup();
    engine.onScan(scanWith(nudgeFor(['1'], ['k1'])));
    await vi.advanceTimersByTimeAsync(10);
    engine.newDocument();
    expect(engine.excludeKeys()).toEqual([]);
    await vi.advanceTimersByTimeAsync(NUDGE_COOLDOWN_MS);
    engine.onScan(scanWith(nudgeFor(['1'], ['k1'])));
    await vi.advanceTimersByTimeAsync(10);
    expect(session.createReply).toHaveBeenCalledTimes(2);
  });

  it('stay silent with nudges off, after "stop suggesting", or on pages Iris doesn’t speak about', async () => {
    const first = setup();
    first.store.settings.value = { ...first.store.settings.value, nudges: false };
    first.engine.onScan(scanWith(nudgeFor(['1'], ['k1'])));
    const second = setup();
    second.store.session.nudgesOff.value = true;
    second.engine.onScan(scanWith(nudgeFor(['1'], ['k1'])));
    const third = setup({ pageType: 'form' });
    third.engine.onScan(scanWith(nudgeFor(['1'], ['k1'])));
    await vi.runAllTimersAsync();
    for (const { session } of [first, second, third])
      expect(session.createReply).not.toHaveBeenCalled();
    expect(third.page.adapter.showChip).toHaveBeenCalledWith({
      kind: 'risks',
      label: '⚠ 1 thing to know',
      element_id: 'i-1',
    });
  });
});

describe('silent fallback', () => {
  it('shows "⚠ N things to know" beside the first risky element with no session', async () => {
    const { page, session, engine, store } = setup({ running: false });
    engine.onScan(
      scanWith(nudgeFor(['1'], ['k1']), [
        risk('1', 'k1'),
        risk('2', 'k2', 'medium'),
        risk('3', 'k3', 'info'),
      ]),
    );
    await vi.runAllTimersAsync();
    expect(session.createReply).not.toHaveBeenCalled();
    expect(page.adapter.showChip).toHaveBeenCalledWith({
      kind: 'risks',
      label: '⚠ 2 things to know',
      element_id: 'i-1',
    });
    expect(store.chips.value).toEqual([{ element_id: 'i-1', label: '⚠ 2 things to know' }]);
  });

  it('counts the page’s own client flags before any scan', async () => {
    const { page } = setup({ running: false });
    page.emit({ type: 'page-changed', revision: 1, captured_at: 'x', navigation: false });
    await vi.runAllTimersAsync();
    expect(page.adapter.showChip).toHaveBeenCalledWith({
      kind: 'risks',
      label: '⚠ 1 thing to know',
      element_id: 'i-20',
    });
  });
});

describe('chips', () => {
  it('follow the page events, with the more specific chip winning', async () => {
    const { page, store } = setup({ running: false });
    page.emit({ type: 'legal_links_near_submit', element_id: 'i-40' });
    page.emit({ type: 'hesitation', element_id: 'i-12' });
    page.emit({ type: 'legal_links_near_submit', element_id: 'i-40' });
    await vi.runAllTimersAsync();
    expect(page.adapter.showChip.mock.calls.map(([chip]) => chip.kind)).toEqual([
      'terms',
      'explain',
    ]);
    expect(store.chips.value).toEqual([{ element_id: 'i-12', label: 'Explain' }]);
    page.emit({ type: 'chip-hidden' });
    expect(store.chips.value).toEqual([]);
  });

  it('Explain opens Iris and explains the field', async () => {
    const { page, actions } = setup({ running: false });
    page.emit({ type: 'chip-clicked', kind: 'explain', element_id: 'i-12' });
    await vi.runAllTimersAsync();
    expect(actions.openIris).toHaveBeenCalled();
    expect(actions.explainField).toHaveBeenCalledWith('i-12');
  });

  it('Show reject option rings "Manage choices" with a note, and Iris says it in a session', async () => {
    const { page, session } = setup();
    page.emit({ type: 'chip-clicked', kind: 'cookie', element_id: 'i-10' });
    await vi.runAllTimersAsync();
    const note = "The reject option is inside 'Manage choices'.";
    expect(page.adapter.highlight).toHaveBeenCalledWith({ ids: ['i-11'], note, level: 'normal' });
    expect(session.createReply).toHaveBeenCalledWith(expect.stringContaining(note));
  });

  it('Read terms for me shows the line when there is no session; risks open the list', async () => {
    const { page, store, actions } = setup({ running: false });
    page.emit({ type: 'chip-clicked', kind: 'terms', element_id: 'i-40' });
    page.emit({ type: 'chip-clicked', kind: 'risks', element_id: 'i-20' });
    await vi.runAllTimersAsync();
    expect(store.notice.value).toEqual({ kind: 'info', message: READ_TERMS_LINE });
    expect(actions.showRisks).toHaveBeenCalled();
  });
});

describe('policies', () => {
  it('"stop suggesting" pattern', () => {
    for (const text of [
      'Stop suggesting things',
      'please no more suggestions',
      "don't nudge me",
      'Do not give me nudges',
    ]) {
      expect(isStopSuggesting(text)).toBe(true);
    }
    for (const text of ['Stop', 'What do you suggest?', 'Can I stop the auto-debit?']) {
      expect(isStopSuggesting(text)).toBe(false);
    }
  });

  it('chip labels match the interface copy', () => {
    expect(chipForPageEvent({ type: 'hesitation', element_id: 'a' })?.label).toBe('Explain');
    expect(chipForPageEvent({ type: 'cookie_banner', element_id: 'a' })?.label).toBe(
      'Show reject option',
    );
    expect(chipForPageEvent({ type: 'legal_links_near_submit', element_id: 'a' })?.label).toBe(
      'Read terms for me',
    );
    expect(risksChipLabel(2)).toBe('⚠ 2 things to know');
    expect(risksChipLabel(1)).toBe('⚠ 1 thing to know');
    expect(chipForRisks([{ severity: 'info', element_ids: ['i-1'] }])).toBeNull();
  });
});

describe('a figure that changed since an earlier page', () => {
  const finding = {
    key: 'journey:processing fee:999:1416',
    say: 'Heads up: the processing fee here is ₹1,416, but the offer page said ₹999.',
    element_id: 'i-7',
  };

  it('is spoken once, with its element ringed', async () => {
    const { session, page, engine } = setup();
    engine.onJourneyFinding(finding);
    await vi.runAllTimersAsync();
    engine.onJourneyFinding(finding);
    await vi.runAllTimersAsync();
    expect(session.createReply).toHaveBeenCalledTimes(1);
    expect(session.createReply).toHaveBeenCalledWith(
      `NUDGE CONTEXT: a figure differs from an earlier page (i-7)\nTell the user this now, keeping the meaning and every figure exactly: "${finding.say}"`,
    );
    expect(page.adapter.highlight).toHaveBeenCalledWith({ ids: ['i-7'], level: 'risk' });
  });

  it('is a notice in the panel without a session, and nothing when nudges are off', () => {
    const quiet = setup({ running: false });
    quiet.engine.onJourneyFinding(finding);
    expect(quiet.store.notice.value).toEqual({ kind: 'info', message: finding.say });
    expect(quiet.session.createReply).not.toHaveBeenCalled();
    const off = setup();
    off.store.session.nudgesOff.value = true;
    off.engine.onJourneyFinding(finding);
    expect(off.store.notice.value).toBeNull();
  });
});

describe('sound cues', () => {
  it('chime just before Iris speaks up by itself', async () => {
    const { session, engine } = setup();
    engine.onScan(scanWith(nudgeFor(['1'], ['k1'])));
    await vi.runAllTimersAsync();
    expect(session.playCue).toHaveBeenCalledTimes(1);
    const cueAt = session.playCue.mock.invocationCallOrder[0] ?? 0;
    const replyAt = session.createReply.mock.invocationCallOrder[0] ?? 0;
    expect(cueAt).toBeLessThan(replyAt);
  });

  it('stay quiet when the user turned them off', async () => {
    const { store, session, engine } = setup();
    store.settings.value = { ...store.settings.value, sound_cues: false };
    engine.onScan(scanWith(nudgeFor(['1'], ['k1'])));
    await vi.runAllTimersAsync();
    expect(session.createReply).toHaveBeenCalledTimes(1);
    expect(session.playCue).not.toHaveBeenCalled();
  });
});

describe('a risky site from the automatic check', () => {
  const warning = {
    key: 'trust:hdfcbank-login.xyz',
    verdict: 'likely_unsafe' as const,
    say: 'Before you log in: this address looks a lot like hdfcbank.com.',
    notice: 'Site check: Likely unsafe. Looks a lot like hdfcbank.com.',
    element_id: 'i-5',
  };

  it('is spoken with a chime and a ring on the login field', async () => {
    const { session, page, engine } = setup();
    engine.onTrustWarning(warning);
    await vi.runAllTimersAsync();
    expect(session.playCue).toHaveBeenCalledTimes(1);
    expect(session.createReply).toHaveBeenCalledWith(
      `NUDGE CONTEXT: site check (likely_unsafe)\nTell the user this now, keeping the meaning and every figure exactly: "${warning.say}"`,
    );
    expect(page.adapter.highlight).toHaveBeenCalledWith({ ids: ['i-5'], level: 'risk' });
  });

  it('is a notice and a chip without a session; the chip opens the trust card', async () => {
    const { store, page, engine, actions } = setup({ running: false });
    engine.onTrustWarning(warning);
    expect(store.notice.value).toEqual({ kind: 'info', message: warning.notice });
    expect(page.adapter.showChip).toHaveBeenCalledWith({
      kind: 'trust',
      label: '⚠ Check this site',
      element_id: 'i-5',
    });
    page.emit({ type: 'chip-clicked', kind: 'trust', element_id: 'i-5' });
    await vi.runAllTimersAsync();
    expect(actions.openIris).toHaveBeenCalled();
    expect(actions.showTrust).toHaveBeenCalled();
  });
});

describe('hover to explain', () => {
  const dwell = { type: 'dwell' as const, element_id: 's-4', section_id: 's-4', price_id: null };

  it('offers "Explain" beside a clause during a session, once per element', () => {
    const { page, engine } = setup();
    engine.onPageEvent(dwell);
    engine.onPageEvent({ type: 'chip-hidden' });
    engine.onPageEvent(dwell);
    expect(page.adapter.showChip).toHaveBeenCalledTimes(1);
    expect(page.adapter.showChip).toHaveBeenCalledWith({
      kind: 'hover',
      label: 'Explain',
      element_id: 's-4',
    });
  });

  it('offers nothing without a session', () => {
    const { page, engine } = setup({ running: false });
    engine.onPageEvent(dwell);
    expect(page.adapter.showChip).not.toHaveBeenCalled();
  });

  it('a tap explains that clause, with its own pointer hint', async () => {
    const { engine, actions } = setup();
    engine.onPageEvent(dwell);
    engine.onPageEvent({ type: 'chip-clicked', kind: 'hover', element_id: 's-4' });
    await vi.runAllTimersAsync();
    expect(actions.openIris).toHaveBeenCalled();
    expect(actions.explainHere).toHaveBeenCalledWith({
      field_id: null,
      price_id: null,
      section_id: 's-4',
    });
  });
});

describe('during a walkthrough', () => {
  it('holds spoken risk nudges: the walkthrough reaches each risky part itself', async () => {
    const store = createStore();
    store.page.value = {
      page_id: 'pg_1',
      page_type: 'terms',
      url: 'https://example.com/terms',
      summary_for_agent: 'PAGE: Terms',
      truncated: false,
      scan: null,
    };
    store.session.state.value = 'listening';
    const session = fakeSession(true);
    const engine = new NudgeEngine({
      store,
      adapter: fakeAdapter().adapter,
      session: () => session,
      actions: {
        openIris: vi.fn(),
        explainField: vi.fn(() => Promise.resolve()),
        showRisks: vi.fn(),
        showTrust: vi.fn(),
        explainHere: vi.fn(() => Promise.resolve()),
        cardForNudge: vi.fn(() => Promise.resolve()),
      },
      touring: () => true,
    });
    engine.onScan(scanWith(nudgeFor(['1'], ['k1'])));
    await vi.runAllTimersAsync();
    expect(session.createReply).not.toHaveBeenCalled();
  });
});
