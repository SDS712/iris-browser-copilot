import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IrisApi, PageType, RiskCategory } from '../../src/core/api';
import { createIrisApp, type IrisApp } from '../../src/core/app';
import { localSettings } from '../../src/core/settings';
import type { CardEntry, SessionState } from '../../src/core/store';
import { captionFor } from '../../src/ui/components/Caption';
import { CardView } from '../../src/ui/components/CardStack';
import { PageStrip } from '../../src/ui/components/PageStrip';
import { Panel } from '../../src/ui/components/Panel';
import { RiskTag } from '../../src/ui/components/RiskTag';
import { AppContext } from '../../src/ui/context';
import { CATEGORY_LABELS, sourceBadgeText, suggestionsFor } from '../../src/ui/labels';
import { SCANS, TOOL_RESULTS, type ToolFixture } from '../fixtures/results';

function testApp(): IrisApp {
  const app = createIrisApp({
    api: {} as IrisApi,
    platform: { kind: 'widget', settings: localSettings() },
    mockVoice: true,
    debug: false,
    workletUrl: '',
  });
  return app;
}

function renderWith(app: IrisApp, children: ComponentChildren) {
  return render(<AppContext.Provider value={app}>{children}</AppContext.Provider>);
}

function card(tool: ToolFixture, expanded = true) {
  const entry: CardEntry = { id: `c-${tool}`, tool, caption: '', result: TOOL_RESULTS[tool] };
  renderWith(testApp(), <CardView entry={entry} expanded={expanded} latest />);
}

afterEach(() => {
  cleanup();
});

describe('cards render from contract-shaped data', () => {
  it('answer: lead, quote with its section heading, and page actions', () => {
    card('ask_page');
    expect(screen.getByRole('heading', { name: 'Cancellation' })).toBeTruthy();
    expect(screen.getByText('From this page')).toBeTruthy();
    expect(screen.getByText('7.2 Cancellation')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show on page' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('answer not found: "Not on this page" and no Show on page', () => {
    card('ask_not_found');
    expect(screen.getByText('Not on this page')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show on page' })).toBeNull();
  });

  it('field: the rows, the web badge with its source count, and Show field', () => {
    card('explain_field');
    for (const label of ['What it is', 'Where to find it', 'Format', 'Common mistake']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('From the web · 2 sources')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show field' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }));
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('risk list: every flag with words and its own Show on page', () => {
    card('scan_tool');
    const risks =
      TOOL_RESULTS.scan_tool.card?.kind === 'risk_list' ? TOOL_RESULTS.scan_tool.card.risks : [];
    expect(risks.length).toBeGreaterThan(0);
    for (const risk of risks) expect(screen.getByText(risk.title)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Show on page' })).toHaveLength(risks.length);
  });

  it('true cost: the backend figures, formatted with Indian grouping', () => {
    card('loan_cost');
    expect(screen.getByText('≈ 36.5% a year')).toBeTruthy();
    expect(screen.getByText('Advertised as 1.5% a month flat')).toBeTruthy();
    expect(screen.getByText('You pay ₹70,799 in total, plus a ₹1,416 fee upfront')).toBeTruthy();
    expect(screen.getByText("That's ₹12,216 more than the price")).toBeTruthy();
    expect(screen.getByText('Calculated')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'How this was worked out' }));
    expect(screen.getByText(/₹5,900 a month for 12 months/)).toBeTruthy();
  });

  it('trust: verdict words, reasons and the checks line', () => {
    card('site_trust');
    expect(screen.getByText('Likely unsafe')).toBeTruthy();
    expect(screen.getByText('arnazon.in')).toBeTruthy();
    expect(screen.getByText('Looks a lot like amazon.in')).toBeTruthy();
    expect(screen.getByText('Checks: domain age, look-alike names, public reports.')).toBeTruthy();
  });

  it('summary and web answer: bullets', () => {
    card('summarize');
    const summary = TOOL_RESULTS.summarize.card;
    const bullets = summary?.kind === 'summary' ? summary.bullets : [];
    expect(screen.getAllByRole('listitem')).toHaveLength(bullets.length);
    cleanup();
    card('web_lookup');
    expect(screen.getByText('From the web · 2 sources')).toBeTruthy();
  });

  it('collapsed: one line with the topic and the badge text', () => {
    card('explain_field_page', false);
    expect(screen.getByRole('button', { name: /IFSC code · From the web/ })).toBeTruthy();
  });

  it('loading: the caption while the tool runs', () => {
    renderWith(
      testApp(),
      <CardView
        entry={{ id: 'l', tool: 'ask_page', caption: 'Checking the terms…', result: null }}
        expanded
        latest
      />,
    );
    expect(screen.getByText('Checking the terms…')).toBeTruthy();
  });
});

describe('risk tags', () => {
  it('always show words, whatever the severity', () => {
    for (const category of Object.keys(CATEGORY_LABELS) as RiskCategory[]) {
      for (const severity of ['high', 'medium', 'info'] as const) {
        const { container } = render(<RiskTag category={category} severity={severity} />);
        expect(container.textContent).toContain(CATEGORY_LABELS[category]);
        cleanup();
      }
    }
  });

  it('use the interface labels', () => {
    expect(CATEGORY_LABELS).toEqual({
      costs_money: 'Costs you money',
      auto_debit: 'Auto-debits you',
      shares_data: 'Shares your data',
      hard_to_cancel: 'Hard to cancel',
      auto_renews: 'Renews automatically',
      limits_rights: 'Limits your rights',
      worth_knowing: 'Worth knowing',
    });
  });
});

describe('source badge text', () => {
  it('follows the interface copy', () => {
    expect(sourceBadgeText('page', 0)).toBe('From this page');
    expect(sourceBadgeText('page', 0, 'QuickCred – Own the Nimbus 14 today')).toBe(
      'From an earlier page · QuickCred – Own the Nimbus 14 today',
    );
    expect(sourceBadgeText('web', 3)).toBe('From the web · 3 sources');
    expect(sourceBadgeText('web', 1)).toBe('From the web · 1 source');
    expect(sourceBadgeText('calculated', 0)).toBe('Calculated');
    expect(sourceBadgeText('not_found', 0)).toBe('Not on this page');
  });
});

describe('welcome suggestions', () => {
  it('match the interface copy for every page type', () => {
    const expected: Record<PageType, string[]> = {
      terms: [
        ...['What should I know here?', 'Can I cancel anytime?', 'Do they share my data?'],
        'Walk me through this page',
      ],
      privacy: [
        ...['What should I know here?', 'Can I cancel anytime?', 'Do they share my data?'],
        'Walk me through this page',
      ],
      checkout: [
        'Anything I should know before I pay?',
        'What am I paying for?',
        'Is this site legit?',
      ],
      form: ['Explain this form', 'What does this field mean?', 'Which fields can I skip?'],
      offer: ["What's the real cost?", 'Summarise the fine print', 'Is this site legit?'],
      article: [
        ...['Summarise this page', 'What should I know here?', 'Is this site legit?'],
        'Walk me through this page',
      ],
      other: [
        ...['Summarise this page', 'What should I know here?', 'Is this site legit?'],
        'Walk me through this page',
      ],
    };
    for (const [type, suggestions] of Object.entries(expected)) {
      expect(suggestionsFor(type as PageType)).toEqual(suggestions);
    }
  });

  it('are shown on the welcome view and send the text when tapped', () => {
    const app = testApp();
    app.store.page.value = {
      page_id: 'pg',
      page_type: 'offer',
      url: '',
      summary_for_agent: '',
      truncated: false,
      scan: null,
    };
    const sendText = vi.spyOn(app, 'sendText');
    renderWith(app, <Panel />);
    expect(screen.getByText("Hi, I'm Iris.")).toBeTruthy();
    expect(screen.getByText('Your voice is processed by AssemblyAI.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "What's the real cost?" }));
    expect(sendText).toHaveBeenCalledWith("What's the real cost?");
  });
});

describe('page strip', () => {
  it('is hidden while the scan is pending', () => {
    const { container } = renderWith(testApp(), <PageStrip scan={null} />);
    expect(container.textContent).toBe('');
  });

  it('groups risks by category with counts, worst first', () => {
    renderWith(testApp(), <PageStrip scan={SCANS.terms} />);
    expect(screen.getByText('This page')).toBeTruthy();
    expect(screen.getByText('1 auto-debit')).toBeTruthy();
    expect(screen.getByText('2 cost you money')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review ▸' })).toBeTruthy();
  });

  it('says "Nothing worrying found" when a finished scan found nothing', () => {
    renderWith(
      testApp(),
      <PageStrip scan={{ ...SCANS.terms, risks: [], counts: { high: 0, medium: 0, info: 0 } }} />,
    );
    expect(screen.getByText('Nothing worrying found')).toBeTruthy();
  });
});

describe('orb captions', () => {
  it('follow the interface copy', () => {
    const { store } = testApp();
    const expected: Partial<Record<SessionState, string>> = {
      idle: 'Tap to talk',
      connecting: 'Connecting…',
      listening: 'Listening',
      muted: 'Mic off',
      error: 'Connection lost · Tap to retry',
    };
    for (const [state, caption] of Object.entries(expected)) {
      expect(captionFor(store.session, state as SessionState)).toBe(caption);
    }
    store.session.toolCaption.value = 'Checking the terms…';
    expect(captionFor(store.session, 'thinking')).toBe('Checking the terms…');
    store.session.userLive.value = 'Can I cancel';
    expect(captionFor(store.session, 'hearing')).toBe('Can I cancel');
  });
});

describe('panel', () => {
  it('shows the active view with the main button reading "End" during a session', () => {
    const app = testApp();
    app.store.session.state.value = 'listening';
    renderWith(app, <Panel />);
    expect(screen.getByRole('button', { name: 'End' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Nudges/ })).toBeTruthy();
  });

  it('has the sound cue setting, on by default, and saves a change', async () => {
    const app = testApp();
    app.store.session.state.value = 'listening';
    renderWith(app, <Panel />);
    screen.getByRole('button', { name: 'Settings' }).click();
    const toggle = await screen.findByRole('switch', { name: /Sound before Iris speaks up/ });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    toggle.click();
    expect(app.store.settings.value.sound_cues).toBe(false);
    expect(JSON.parse(localStorage.getItem('iris.settings') ?? '{}')).toMatchObject({
      sound_cues: false,
    });
    // Settings saved before the chime existed still load, with the chime on.
    localStorage.setItem('iris.settings', JSON.stringify({ nudges: false, captions: true }));
    expect(await localSettings().load()).toEqual({
      nudges: false,
      captions: true,
      sound_cues: true,
      voice: 'female',
    });
  });

  it('has settings on the welcome screen, with captions on and the female voice by default', async () => {
    const app = testApp();
    renderWith(app, <Panel />);
    expect(screen.getByText("Hi, I'm Iris.")).toBeTruthy();
    screen.getByRole('button', { name: 'Settings' }).click();
    const captions = await screen.findByRole('switch', { name: /Always show captions/ });
    expect(captions.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('group', { name: 'Voice' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Female' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Male' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('saves the voice, and says a running session keeps its own until the next one', async () => {
    const app = testApp();
    app.store.session.state.value = 'listening';
    app.store.session.voice.value = 'female';
    renderWith(app, <Panel />);
    screen.getByRole('button', { name: 'Settings' }).click();
    (await screen.findByRole('button', { name: 'Male' })).click();
    expect(app.store.settings.value.voice).toBe('male');
    expect(JSON.parse(localStorage.getItem('iris.settings') ?? '{}')).toMatchObject({
      voice: 'male',
    });
    expect(await screen.findByText('Applies next time you start Iris.')).toBeTruthy();
    screen.getByRole('button', { name: 'Female' }).click();
    await waitFor(() => {
      expect(screen.queryByText('Applies next time you start Iris.')).toBeNull();
    });
  });

  it('keeps the conversation in view after a session ends', () => {
    const app = testApp();
    app.store.session.transcript.value = [{ id: 1, who: 'you', text: 'Hi Iris' }];
    renderWith(app, <Panel />);
    expect(screen.queryByText("Hi, I'm Iris.")).toBeNull();
    expect(screen.getByRole('button', { name: 'Talk to Iris' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Transcript (1)' })).toBeTruthy();
  });

  it('Esc in the panel stops Iris and clears highlights', () => {
    const app = testApp();
    const escape = vi.spyOn(app, 'escape');
    app.store.session.state.value = 'speaking';
    renderWith(app, <Panel />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'End' }), { key: 'Escape' });
    expect(escape).toHaveBeenCalledTimes(1);
  });

  it('asks for the microphone while idle, but never hides a running session', () => {
    const app = testApp();
    app.store.micPrompt.value = true;
    renderWith(app, <Panel />);
    expect(screen.getByRole('button', { name: 'Allow microphone' })).toBeTruthy();
    cleanup();
    app.store.session.state.value = 'listening';
    renderWith(app, <Panel />);
    expect(screen.getByRole('button', { name: 'End' })).toBeTruthy();
    expect(screen.queryByText("Hi, I'm Iris.")).toBeNull();
  });

  it('shows "Try again" after an error', () => {
    const app = testApp();
    app.store.session.state.value = 'error';
    app.store.cards.value = [
      { id: 'c', tool: 'ask_page', caption: '', result: TOOL_RESULTS.ask_page },
    ];
    renderWith(app, <Panel />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('microphone permission (extension)', () => {
  it('shows the permission view when the grant lapses, and restarts capture once allowed', () => {
    const app = testApp();
    const retry = vi.spyOn(app.session, 'retryMicrophone');
    app.onMicPermission(false);
    expect(app.store.micPrompt.value).toBe(true);
    expect(retry).not.toHaveBeenCalled();
    app.onMicPermission(true);
    expect(app.store.micPrompt.value).toBe(false);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
