import { describe, expect, it, vi } from 'vitest';
import type { CreatePageResponse, PageSnapshot, ToolResult } from '../../src/core/api';
import { createStore } from '../../src/core/store';
import {
  isLocalHost,
  loginOrPaymentField,
  memorySites,
  TrustWatch,
} from '../../src/core/trust-watch';
import type { NudgeEngine, TrustWarning } from '../../src/core/nudges';
import { fakeApi, snapshot } from './fakes';

const field = (overrides: Partial<PageSnapshot['fields'][number]>) => ({
  id: 'i-5',
  label: 'Password',
  type: 'password' as const,
  required: true,
  placeholder: null,
  help_text: null,
  section: null,
  options: [],
  filled: false,
  sensitive: true,
  ...overrides,
});

function response(signals: string[] = []): CreatePageResponse {
  return {
    contract_version: 1,
    page_id: 'pg_1',
    page_type: 'form',
    summary_for_agent: 'PAGE: Sign in',
    scan: { status: 'none', kind: null },
    site_signals: signals,
  };
}

function trustResult(verdict: 'looks_ok' | 'be_careful' | 'likely_unsafe'): ToolResult {
  return {
    contract_version: 1,
    say: 'This address looks a lot like hdfcbank.com, but it isn’t the official site, so it’s likely unsafe. Want the details?',
    agent_notes: '',
    card: {
      kind: 'trust',
      topic: 'Site check',
      source: 'web',
      lead: 'Likely unsafe. Looks a lot like hdfcbank.com.',
      verdict,
      domain: 'hdfcbank-login.xyz',
      reasons: [],
      checks_line: 'Checks: domain age, look-alike names, public reports.',
    },
    highlight_ids: [],
    quote_text: null,
    sources: [],
    not_found: false,
  };
}

function setup(verdict: 'looks_ok' | 'be_careful' | 'likely_unsafe' = 'likely_unsafe') {
  const store = createStore();
  const api = fakeApi();
  api.tool.mockResolvedValue(trustResult(verdict));
  const nudges = { allowed: true, onTrustWarning: vi.fn<(warning: TrustWarning) => void>() };
  const watch = new TrustWatch({
    api,
    store,
    nudges: () => nudges as unknown as NudgeEngine,
    checked: memorySites(),
  });
  return { store, api, nudges, watch };
}

const login = snapshot({ url: 'https://hdfcbank-login.xyz/signin', fields: [field({})] });

describe('the automatic site check', () => {
  it('checks a login page and warns about a risky site once', async () => {
    const { store, api, nudges, watch } = setup();
    await watch.onNewDocument(login, response());
    await watch.onNewDocument(login, response());
    expect(api.tool).toHaveBeenCalledTimes(1);
    expect(api.tool).toHaveBeenCalledWith('site-trust', { url: login.url });
    expect(nudges.onTrustWarning).toHaveBeenCalledWith({
      key: 'trust:hdfcbank-login.xyz:login',
      verdict: 'likely_unsafe',
      say: 'Before you log in: this address looks a lot like hdfcbank.com, but it isn’t the official site, so it’s likely unsafe. Want the details?',
      notice: 'Site check: Likely unsafe. Looks a lot like hdfcbank.com.',
      element_id: 'i-5',
    });
    expect(store.cards.value[0]?.result?.card?.kind).toBe('trust');
  });

  it('says nothing when the site looks fine', async () => {
    const { store, nudges, watch } = setup('looks_ok');
    await watch.onNewDocument(login, response());
    expect(nudges.onTrustWarning).not.toHaveBeenCalled();
    expect(store.cards.value).toEqual([]);
  });

  it('checks a page with suspicious signs even without a form, and a payment form', async () => {
    const signs = setup();
    await signs.watch.onNewDocument(snapshot({ url: 'http://8.8.8.8/' }), response(['ip_host']));
    expect(signs.api.tool).toHaveBeenCalledTimes(1);
    const pay = setup();
    const card = field({ id: 'i-8', label: 'Card number', type: 'text' });
    await pay.watch.onNewDocument(
      snapshot({ url: 'https://shop.example/pay', fields: [card] }),
      response(),
    );
    expect(pay.nudges.onTrustWarning.mock.calls[0]?.[0]).toMatchObject({
      say: expect.stringMatching(/^Before you pay: /) as unknown,
      element_id: 'i-8',
    });
  });

  it('skips ordinary pages, local hosts and turned-off nudges', async () => {
    const ordinary = setup();
    await ordinary.watch.onNewDocument(snapshot({ url: 'https://shop.example/' }), response());
    const local = setup();
    await local.watch.onNewDocument(
      snapshot({ url: 'http://localhost:4321/demo/apply', fields: [field({})] }),
      response(),
    );
    const off = setup();
    off.nudges.allowed = false;
    await off.watch.onNewDocument(login, response());
    for (const run of [ordinary, local, off]) expect(run.api.tool).not.toHaveBeenCalled();
  });

  it('ignores a failed check', async () => {
    const { api, nudges, watch } = setup();
    api.tool.mockRejectedValue(new Error('down'));
    await watch.onNewDocument(login, response());
    expect(nudges.onTrustWarning).not.toHaveBeenCalled();
  });
});

describe('warning once per moment', () => {
  it('warns on arrival, then again at the login form, and not twice for either', async () => {
    const { api, nudges, watch } = setup();
    const home = snapshot({ url: 'http://hdfcbank-login.xyz/' });
    await watch.onNewDocument(home, response(['no_https']));
    await watch.onNewDocument(home, response(['no_https']));
    await watch.onNewDocument(login, response(['no_https']));
    await watch.onNewDocument(login, response(['no_https']));
    expect(api.tool).toHaveBeenCalledTimes(2);
    expect(nudges.onTrustWarning.mock.calls.map(([w]) => w.key)).toEqual([
      'trust:hdfcbank-login.xyz:site',
      'trust:hdfcbank-login.xyz:login',
    ]);
  });

  it('never checks again a site that looked fine', async () => {
    const { api, watch } = setup('looks_ok');
    await watch.onNewDocument(login, response());
    await watch.onNewDocument(snapshot({ url: login.url, fields: [] }), response(['no_https']));
    expect(api.tool).toHaveBeenCalledTimes(1);
  });
});

describe('helpers', () => {
  it('knows local hosts', () => {
    for (const host of ['localhost', 'app.local', '127.0.0.1', '10.1.2.3', '192.168.0.9', '::1'])
      expect(isLocalHost(host)).toBe(true);
    for (const host of ['8.8.8.8', 'iris.example.com', 'iris-login.test'])
      expect(isLocalHost(host)).toBe(false);
  });

  it('finds the login field first, then a payment field', () => {
    expect(loginOrPaymentField(snapshot({ fields: [] }))).toBeNull();
    const fields = [field({ id: 'i-1', label: 'CVV', type: 'text' }), field({ id: 'i-2' })];
    expect(loginOrPaymentField(snapshot({ fields }))).toEqual({ id: 'i-2', kind: 'login' });
  });
});
