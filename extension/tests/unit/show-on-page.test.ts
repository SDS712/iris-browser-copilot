import { describe, expect, it, vi } from 'vitest';
import { createIrisApp } from '../../src/core/app';
import { localSettings } from '../../src/core/settings';
import { cardHighlight } from '../../src/core/show-on-page';
import { addCard } from '../../src/core/store';
import { TOOL_RESULTS } from '../fixtures/results';
import { fakeAdapter, fakeApi } from './fakes';

describe('show on page', () => {
  it('uses the result highlights and quote for answers', () => {
    expect(cardHighlight(TOOL_RESULTS.ask_page)).toEqual({
      ids: TOOL_RESULTS.ask_page.highlight_ids,
      quote_text: TOOL_RESULTS.ask_page.quote_text,
      level: 'normal',
    });
  });

  it('puts the field first for field cards', () => {
    const request = cardHighlight(TOOL_RESULTS.explain_field_page);
    const card = TOOL_RESULTS.explain_field_page.card;
    expect(request?.ids[0]).toBe(card?.kind === 'field' ? card.field_id : undefined);
  });

  it('shows one risk of a risk list with its title and tag', () => {
    const card = TOOL_RESULTS.scan_tool.card;
    if (card?.kind !== 'risk_list') throw new Error('fixture');
    const risk = card.risks[0];
    if (!risk) throw new Error('fixture');
    expect(cardHighlight(TOOL_RESULTS.scan_tool, 0)).toMatchObject({
      level: 'risk',
      title: risk.title,
      risk: { severity: risk.severity, category: risk.category },
    });
    expect(cardHighlight(TOOL_RESULTS.scan_tool, 99)).toBeNull();
  });

  it('has nothing to show for cards without highlights', () => {
    expect(cardHighlight(TOOL_RESULTS.site_trust)).toBeNull();
  });

  it('steps through a card’s items on each tap', async () => {
    const page = fakeAdapter();
    const app = createIrisApp({
      api: fakeApi(),
      platform: { kind: 'widget', settings: localSettings() },
      mockVoice: true,
      debug: false,
      workletUrl: '',
      adapter: page.adapter,
    });
    const result = { ...TOOL_RESULTS.ask_page, highlight_ids: ['s-1', 's-2', 's-3'] };
    const id = addCard(app.store, 'ask_page', result);
    for (let tap = 0; tap < 4; tap += 1) app.showOnPage(id);
    await vi.waitFor(() => {
      expect(page.adapter.highlight).toHaveBeenCalledTimes(4);
    });
    const focus = page.adapter.highlight.mock.calls.map(
      ([request]) => (request as { focus?: number }).focus,
    );
    expect(focus).toEqual([0, 1, 2, 0]);
    app.dispose();
  });
});

describe('tools started from the interface', () => {
  it('show the card and have Iris say the result when a session is running', async () => {
    const page = fakeAdapter();
    const api = fakeApi();
    api.tool.mockResolvedValue(TOOL_RESULTS.explain_field);
    const app = createIrisApp({
      api,
      platform: { kind: 'widget', settings: localSettings() },
      mockVoice: true,
      debug: false,
      workletUrl: '',
      adapter: page.adapter,
    });
    await app.openPage();
    vi.useFakeTimers();
    const started = app.session.start({ greet: false });
    await vi.advanceTimersByTimeAsync(400);
    await started;
    const reply = vi.spyOn(app.session, 'createReply');
    await app.runFromInterface('explain_field', { field_label: 'CKYC number' }, 'Explain');
    expect(app.store.cards.value[0]?.result).toEqual(TOOL_RESULTS.explain_field);
    expect(reply).toHaveBeenCalledWith(
      `The user tapped Explain in the Iris interface. The card for it is on screen. Tell the user this now, keeping the meaning and every figure exactly: "${TOOL_RESULTS.explain_field.say}"`,
    );
    expect(app.store.session.spoken.value).toContain(TOOL_RESULTS.explain_field.say);
    vi.useRealTimers();
    app.dispose();
  });

  it('only show the card without a session', async () => {
    const api = fakeApi();
    api.tool.mockResolvedValue(TOOL_RESULTS.web_lookup);
    const app = createIrisApp({
      api,
      platform: { kind: 'widget', settings: localSettings() },
      mockVoice: true,
      debug: false,
      workletUrl: '',
      adapter: fakeAdapter().adapter,
    });
    const reply = vi.spyOn(app.session, 'createReply');
    await app.runFromInterface('web_lookup', { query: 'NACH' }, 'a chip');
    expect(app.store.cards.value).toHaveLength(1);
    expect(reply).not.toHaveBeenCalled();
    app.dispose();
  });
});
