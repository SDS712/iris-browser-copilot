import { describe, expect, it, vi } from 'vitest';
import { extensionAdapter, type ExtensionApi } from '../../../src/adapters/extension-adapter';
import { startBackground, type BackgroundApi } from '../../../src/extension/background-main';
import { badgeFor, fromThisExtension, isContentRequest } from '../../../src/extension/messages';

const ID = 'kjcchlmlkmljbpaobhidapkobbbdfmap';

describe('messages', () => {
  it('badge: high and medium flags, red when any are high', () => {
    expect(badgeFor(0, 0)).toEqual({ text: '', color: '#B54708' });
    expect(badgeFor(2, 1)).toEqual({ text: '3', color: '#B42318' });
    expect(badgeFor(0, 1)).toEqual({ text: '1', color: '#B54708' });
  });

  it('only this extension’s messages count', () => {
    expect(fromThisExtension({ id: ID }, ID)).toBe(true);
    expect(fromThisExtension({ id: 'someone-else' }, ID)).toBe(false);
    expect(fromThisExtension({}, ID)).toBe(false);
    expect(isContentRequest({ type: 'iris/get-snapshot' })).toBe(true);
    expect(isContentRequest({ type: 'steal-values' })).toBe(false);
    expect(isContentRequest('iris/get-snapshot')).toBe(false);
  });
});

function adapterApi(url: string, fail: 'connection' | 'reply' | null) {
  let calls = 0;
  const listeners: ((message: unknown, sender: { id?: string; tab?: { id?: number } }) => void)[] =
    [];
  const api = {
    runtime: {
      id: ID,
      onMessage: {
        addListener: (l: (typeof listeners)[number]) => listeners.push(l),
        removeListener: vi.fn(),
      },
    },
    tabs: {
      sendMessage: vi.fn(() => {
        calls += 1;
        if (fail === 'connection' && calls === 1)
          return Promise.reject(new Error('Receiving end does not exist'));
        if (fail === 'reply') return Promise.resolve({ ok: false, error: 'Broken' });
        return Promise.resolve({ ok: true, value: { url } });
      }),
      get: vi.fn(() => Promise.resolve({ url })),
    },
    scripting: { executeScript: vi.fn(() => Promise.resolve([])) },
  } satisfies ExtensionApi;
  return { api, listeners };
}

describe('extension adapter', () => {
  it('injects the content script once into a tab opened before the install', async () => {
    const { api } = adapterApi('https://example.com/terms', 'connection');
    const adapter = extensionAdapter(api, () => 7);
    await expect(adapter.getSnapshot()).resolves.toEqual({ url: 'https://example.com/terms' });
    expect(api.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ['content-scripts/content.js'],
    });
  });

  it('never injects into browser pages, or when the content script answered with an error', async () => {
    const first = adapterApi('chrome://settings', 'connection');
    await expect(extensionAdapter(first.api, () => 7).getSnapshot()).rejects.toThrow();
    expect(first.api.scripting.executeScript).not.toHaveBeenCalled();
    const second = adapterApi('https://example.com', 'reply');
    await expect(extensionAdapter(second.api, () => 7).getSnapshot()).rejects.toThrow('Broken');
    expect(second.api.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('passes on page events only from the tab it follows, and only from this extension', () => {
    const { api, listeners } = adapterApi('https://example.com', null);
    const adapter = extensionAdapter(api, () => 7);
    const seen = vi.fn();
    adapter.onPageEvent(seen);
    const event = { type: 'iris/page-event', event: { type: 'chip-hidden' } };
    for (const listener of listeners) {
      listener(event, { id: ID, tab: { id: 8 } });
      listener(event, { id: 'other', tab: { id: 7 } });
      listener(event, { id: ID, tab: { id: 7 } });
    }
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

function backgroundApi() {
  type MessageListener = Parameters<BackgroundApi['runtime']['onMessage']['addListener']>[0];
  const handlers: {
    message?: MessageListener;
    connect?: Parameters<BackgroundApi['runtime']['onConnect']['addListener']>[0];
    updated?: (tabId: number, change: { status?: string }) => void;
    command?: (command: string, tab?: { id?: number; windowId?: number }) => void;
  } = {};
  const api = {
    runtime: {
      id: ID,
      onInstalled: { addListener: vi.fn() },
      onConnect: {
        addListener: (l: NonNullable<typeof handlers.connect>) => (handlers.connect = l),
      },
      onMessage: { addListener: (l: MessageListener) => (handlers.message = l) },
    },
    sidePanel: {
      setPanelBehavior: vi.fn(() => Promise.resolve()),
      open: vi.fn(() => Promise.resolve()),
    },
    action: {
      setBadgeText: vi.fn(() => Promise.resolve()),
      setBadgeBackgroundColor: vi.fn(() => Promise.resolve()),
    },
    tabs: {
      onUpdated: {
        addListener: (l: NonNullable<typeof handlers.updated>) => (handlers.updated = l),
      },
    },
    commands: {
      onCommand: {
        addListener: (l: NonNullable<typeof handlers.command>) => (handlers.command = l),
      },
    },
  } satisfies BackgroundApi;
  startBackground(api);
  const send = (
    message: unknown,
    sender: { id?: string; tab?: { id?: number; windowId?: number } },
  ) =>
    new Promise<unknown>((resolve) => {
      const async = handlers.message?.(message, sender, resolve);
      if (!async)
        setTimeout(() => {
          resolve(undefined);
        }, 0);
    });
  return { api, handlers, send };
}

function fakePort() {
  const listeners: { message?: (m: unknown) => void; disconnect?: () => void } = {};
  return {
    port: {
      name: 'sidepanel',
      sender: { id: ID },
      postMessage: vi.fn(),
      onMessage: { addListener: (l: (m: unknown) => void) => (listeners.message = l) },
      onDisconnect: { addListener: (l: () => void) => (listeners.disconnect = l) },
    },
    listeners,
  };
}

describe('background', () => {
  const tab = { id: ID, tab: { id: 5, windowId: 1 } };

  it('sets the badge from flag counts and clears it on navigation', async () => {
    const { api, handlers, send } = backgroundApi();
    await send({ type: 'iris/flag-counts', high: 1, medium: 1 }, tab);
    expect(api.action.setBadgeText).toHaveBeenCalledWith({ tabId: 5, text: '2' });
    expect(api.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 5, color: '#B42318' });
    handlers.updated?.(5, { status: 'loading' });
    expect(api.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 5, text: '' });
  });

  it('ignores messages from other extensions', async () => {
    const { api, send } = backgroundApi();
    await send({ type: 'iris/flag-counts', high: 3, medium: 0 }, { id: 'other', tab: { id: 5 } });
    expect(api.action.setBadgeText).not.toHaveBeenCalled();
  });

  it('keeps a chip tap for the panel, opens it, and knows when the panel follows the tab', async () => {
    const { api, send } = backgroundApi();
    expect(await send({ type: 'iris/panel-attached' }, tab)).toBe(false);
    expect(
      await send({ type: 'iris/chip-clicked', kind: 'cookie', element_id: 'i-6' }, tab),
    ).toEqual({ opened: true });
    expect(api.sidePanel.open).toHaveBeenCalledWith({ tabId: 5 });
    expect(await send({ type: 'iris/take-intent', windowId: 1 }, { id: ID })).toEqual({
      tabId: 5,
      kind: 'cookie',
      element_id: 'i-6',
    });
    expect(await send({ type: 'iris/take-intent', windowId: 1 }, { id: ID })).toBeNull();
  });

  it('routes the keyboard command to an open panel, or opens one and keeps the command', async () => {
    const { api, handlers, send } = backgroundApi();
    const { port, listeners } = fakePort();
    handlers.connect?.(port);
    listeners.message?.({ type: 'iris/attach', windowId: 1, tabId: 5 });
    expect(await send({ type: 'iris/panel-attached' }, tab)).toBe(true);
    handlers.command?.('toggle-iris', { id: 5, windowId: 1 });
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'iris/command', command: 'toggle-iris' });
    listeners.disconnect?.();
    handlers.command?.('toggle-iris', { id: 5, windowId: 1 });
    expect(api.sidePanel.open).toHaveBeenCalledWith({ windowId: 1 });
    expect(await send({ type: 'iris/take-intent', windowId: 1 }, { id: ID })).toMatchObject({
      kind: 'toggle',
    });
  });
});
