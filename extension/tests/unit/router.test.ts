import { describe, expect, it, vi } from 'vitest';
import { IrisApiError, type ToolResult } from '../../src/core/api';
import { COPY } from '../../src/core/copy';
import { PageContext } from '../../src/core/context';
import { createStore } from '../../src/core/store';
import { ToolRouter, shownText } from '../../src/core/tools/router';
import { TOOL_RESULTS } from '../fixtures/results';
import { fakeAdapter, fakeApi, fakeSession } from './fakes';

async function setup(tool: (endpoint: string, body: unknown) => Promise<ToolResult>) {
  const store = createStore();
  const page = fakeAdapter();
  const api = fakeApi();
  api.tool.mockImplementation(tool);
  const session = fakeSession();
  const context = new PageContext({
    api,
    store,
    adapter: page.adapter,
    session: () => session,
    sleep: () => Promise.resolve(),
  });
  await context.start();
  const router = new ToolRouter({
    api,
    store,
    adapter: page.adapter,
    context,
    pageUrl: () => 'https://example.com/terms',
    submit: vi.fn(),
  });
  return { store, page, api, router };
}

describe('tool router', () => {
  it('sends what the user points at with explain_field and ask_page', async () => {
    const { page, api, router } = await setup(() => Promise.resolve(TOOL_RESULTS.ask_page));
    const hint = { field_id: 'i-15', price_id: null, section_id: 's-3' };
    page.adapter.pointerHint.mockResolvedValue(hint);
    await router.run('explain_field', {});
    await router.run('ask_page', { question: 'What does this mean?' });
    expect(api.tool).toHaveBeenCalledWith('explain-field', {
      page_id: 'pg_1',
      field_id: null,
      field_label: null,
      pointer: hint,
    });
    expect(api.tool).toHaveBeenCalledWith('ask-page', {
      page_id: 'pg_1',
      question: 'What does this mean?',
      pointer: hint,
      earlier_page_ids: [],
    });
  });

  it('uses a pointer the interface passes itself (the hover "Explain" chip)', async () => {
    const { page, api, router } = await setup(() => Promise.resolve(TOOL_RESULTS.ask_page));
    page.adapter.pointerHint.mockResolvedValue({
      field_id: 'i-1',
      price_id: null,
      section_id: null,
    });
    const pointer = { field_id: null, price_id: null, section_id: 's-4' };
    await router.run('ask_page', { question: 'What does this mean?', pointer });
    expect(api.tool).toHaveBeenCalledWith('ask-page', {
      page_id: 'pg_1',
      question: 'What does this mean?',
      pointer,
      earlier_page_ids: [],
    });
  });

  it('asks without a hint when the page can’t give one', async () => {
    const { page, api, router } = await setup(() => Promise.resolve(TOOL_RESULTS.ask_page));
    page.adapter.pointerHint.mockRejectedValue(new Error('No tab'));
    await router.run('ask_page', { question: 'Is this normal?' });
    expect(api.tool).toHaveBeenCalledWith('ask-page', {
      page_id: 'pg_1',
      question: 'Is this normal?',
      pointer: null,
      earlier_page_ids: [],
    });
  });

  it('shows a loading card with the caption, then the card and highlights, then returns the agent JSON', async () => {
    let seenCaption: string | null = null;
    const { store, page, api, router } = await setup((_endpoint, _body) => {
      seenCaption = store.cards.value[0]?.caption ?? null;
      return Promise.resolve(TOOL_RESULTS.ask_page);
    });
    const outcome = await router.run('ask_page', { question: 'Can I cancel anytime?' });
    expect(seenCaption).toBe(COPY.orb.checkingTerms);
    expect(api.tool).toHaveBeenCalledWith('ask-page', {
      page_id: 'pg_1',
      question: 'Can I cancel anytime?',
      pointer: null,
      earlier_page_ids: [],
    });
    expect(store.cards.value[0]?.result).toEqual(TOOL_RESULTS.ask_page);
    expect(page.adapter.highlight).toHaveBeenCalledWith({
      ids: TOOL_RESULTS.ask_page.highlight_ids,
      quote_text: TOOL_RESULTS.ask_page.quote_text,
      level: 'normal',
    });
    expect(outcome).toMatchObject({
      isError: false,
      agentResult: {
        say: TOOL_RESULTS.ask_page.say,
        notes: TOOL_RESULTS.ask_page.agent_notes,
        not_found: false,
        shown: shownText(TOOL_RESULTS.ask_page, TOOL_RESULTS.ask_page.highlight_ids.length),
      },
    });
  });

  it('keeps one card when a tool returns the same card again, and both when they differ', async () => {
    const results = [TOOL_RESULTS.ask_page, TOOL_RESULTS.summarize, TOOL_RESULTS.ask_page];
    const { store, router } = await setup(() => Promise.resolve(results.shift() as ToolResult));
    await router.run('ask_page', { question: 'Can I cancel anytime?' });
    await router.run('summarize_page', {});
    await router.run('ask_page', { question: 'Can I cancel anytime?' });
    expect(store.cards.value.map((entry) => entry.result?.card)).toEqual([
      TOOL_RESULTS.ask_page.card,
      TOOL_RESULTS.summarize.card,
    ]);
    expect(store.expandedCard.value).toBe(store.cards.value[0]?.id);
  });

  it('removes the loading card and sends the agent message on an error', async () => {
    const { store, router } = await setup(() =>
      Promise.reject(
        new IrisApiError('upstream_error', 'Failed', 'Web search is unavailable.', 502),
      ),
    );
    const outcome = await router.run('web_lookup', { query: 'NACH' });
    expect(store.cards.value).toEqual([]);
    expect(outcome).toEqual({
      agentResult: { error: 'Web search is unavailable.' },
      isError: true,
      toolResult: null,
    });
  });

  it('registers the page again and retries once on page_not_found', async () => {
    let calls = 0;
    const { api, router } = await setup((_endpoint, body) => {
      calls += 1;
      if (calls === 1)
        return Promise.reject(new IrisApiError('page_not_found', 'Gone', 'Gone', 404));
      expect((body as { page_id: string }).page_id).toBe('pg_2');
      return Promise.resolve(TOOL_RESULTS.summarize);
    });
    const outcome = await router.run('summarize_page', { style: 'quick' });
    expect(outcome.isError).toBe(false);
    expect(api.registerPage).toHaveBeenCalledTimes(2);
  });

  it('answers get_page_overview locally', async () => {
    const { router } = await setup(() => Promise.reject(new Error('not called')));
    const outcome = await router.run('get_page_overview', {});
    expect(outcome.agentResult).toEqual({
      overview: 'PAGE: Terms',
      risk_counts: { high: 0, medium: 0, info: 0 },
      top_risks: [],
    });
  });

  it('highlights elements for highlight_element, with the note cut to 80 characters', async () => {
    const { page, router } = await setup(() => Promise.reject(new Error('not called')));
    const outcome = await router.run('highlight_element', {
      element_ids: ['i-20'],
      note: 'x'.repeat(100),
    });
    expect(outcome.agentResult).toEqual({ ok: true, found: ['i-20'], missing: [] });
    expect(page.adapter.highlight).toHaveBeenCalledWith({
      ids: ['i-20'],
      note: 'x'.repeat(80),
      level: 'normal',
    });
  });

  it('adds the page URL for site trust and marks risk lists as risk highlights', async () => {
    const { api, page, router } = await setup((endpoint) =>
      Promise.resolve(endpoint === 'scan' ? TOOL_RESULTS.scan_tool : TOOL_RESULTS.site_trust),
    );
    await router.run('check_site_trust', {});
    expect(api.tool).toHaveBeenCalledWith('site-trust', { url: 'https://example.com/terms' });
    await router.run('scan_page_risks', {});
    expect(page.adapter.highlight).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: 'risk' }),
    );
  });

  it('refuses unknown tools', async () => {
    const { router } = await setup(() => Promise.reject(new Error('not called')));
    expect((await router.run('delete_everything', {})).isError).toBe(true);
  });
});
