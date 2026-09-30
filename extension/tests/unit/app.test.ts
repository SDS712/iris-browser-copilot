import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IrisApi } from '../../src/core/api';
import { createIrisApp, type IrisApp } from '../../src/core/app';
import type { SessionHandover } from '../../src/core/session';
import { localSettings } from '../../src/core/settings';

let app: IrisApp | null = null;

afterEach(() => {
  app?.dispose();
  app = null;
});

function widgetApp(keep: boolean) {
  const save = vi.fn<(handover: SessionHandover) => void>();
  app = createIrisApp({
    api: {} as IrisApi,
    platform: {
      kind: 'widget',
      settings: localSettings(),
      keepAcrossPageLoads: { shouldKeep: () => keep, save },
    },
    mockVoice: true,
    debug: false,
    workletUrl: '',
  });
  return { app, save };
}

async function live(app: IrisApp): Promise<void> {
  app.talk();
  await vi.waitFor(() => {
    expect(app.store.session.state.value).toBe('listening');
  });
}

describe('leaving the page with a session running', () => {
  it('hands the session to the next page of the same site', async () => {
    const { app, save } = widgetApp(true);
    await live(app);
    window.dispatchEvent(new Event('pagehide'));
    expect(save.mock.calls[0]?.[0].session_id).toBe('mock-session');
    expect(app.session.isRunning).toBe(false);
  });

  it('ends it when the page goes anywhere else', async () => {
    const { app, save } = widgetApp(false);
    await live(app);
    const endNow = vi.spyOn(app.session, 'endNow');
    window.dispatchEvent(new Event('pagehide'));
    expect(save).not.toHaveBeenCalled();
    expect(endNow).toHaveBeenCalled();
  });

  it('carries on quietly on the next page, with no greeting', async () => {
    const { app } = widgetApp(true);
    app.continueSession({ session_id: 'mock-session', started_at: Date.now() });
    expect(app.store.session.quietResume.value).toBe(true);
    await vi.waitFor(() => {
      expect(app.store.session.state.value).toBe('listening');
    });
    await app.endSession();
    expect(app.store.session.quietResume.value).toBe(false);
  });
});

describe('a typed walkthrough command', () => {
  it('moves the running walkthrough itself instead of asking the agent', () => {
    const { app } = widgetApp(false);
    const run = vi.spyOn(app, 'runTool');
    const sent = vi.spyOn(app.session, 'sendUserText');
    app.store.tour.value = {
      page_id: 'pg_1',
      key: 's-1',
      heading: 'Fees',
      say: 'About fees.',
      risk_ids: [],
      index: 0,
      total: 3,
    };
    app.sendText('next');
    expect(sent).not.toHaveBeenCalled();
    expect(app.store.session.transcript.value.at(-1)?.text).toBe('next');
    app.store.tour.value = null;
    app.sendText('next');
    expect(sent).toHaveBeenCalledWith('next');
    run.mockRestore();
  });
});
