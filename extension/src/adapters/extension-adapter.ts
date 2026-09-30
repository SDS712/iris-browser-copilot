/**
 * The side panel's page adapter: typed messages to the content script of the
 * tab the panel is following. Pages opened before Iris was installed have no content
 * script yet, so it's injected once on first use.
 */
import type { OverlayRect } from '../page/overlay/overlay';
import type { PageSnapshot, PointerHint } from '../core/api';
import {
  fromThisExtension,
  isContentReport,
  type ContentReply,
  type ContentRequest,
} from '../extension/messages';
import type { ElementDescription, HighlightResult, PageAdapter, PageEvent } from './page-adapter';

/** The parts of the extension API the adapter uses (easy to fake in tests). */
export interface ExtensionApi {
  runtime: {
    id: string;
    onMessage: {
      addListener(
        listener: (message: unknown, sender: { id?: string; tab?: { id?: number } }) => void,
      ): void;
      removeListener(
        listener: (message: unknown, sender: { id?: string; tab?: { id?: number } }) => void,
      ): void;
    };
  };
  tabs: {
    sendMessage(tabId: number, message: ContentRequest): Promise<unknown>;
    get(tabId: number): Promise<{ url?: string }>;
  };
  scripting?: {
    executeScript(options: { target: { tabId: number }; files: string[] }): Promise<unknown>;
  };
}

export const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

/** Iris can run on web pages and local files, never on the browser's own pages. */
export function isReadableUrl(url: string | undefined): boolean {
  return !!url && /^(https?|file):/i.test(url);
}

export interface ExtensionAdapter extends PageAdapter {
  dispose(): void;
}

export function extensionAdapter(api: ExtensionApi, tabId: () => number | null): ExtensionAdapter {
  const listeners = new Set<(event: PageEvent) => void>();
  const injected = new Set<number>();

  const onMessage = (message: unknown, sender: { id?: string; tab?: { id?: number } }) => {
    if (!fromThisExtension(sender, api.runtime.id) || !isContentReport(message)) return;
    if (message.type !== 'iris/page-event' || sender.tab?.id !== tabId()) return;
    for (const listener of listeners) listener(message.event);
  };
  api.runtime.onMessage.addListener(onMessage);

  async function send<T>(message: ContentRequest): Promise<T> {
    const tab = tabId();
    if (tab === null) throw new Error('No tab to read');
    let reply: unknown;
    try {
      reply = await api.tabs.sendMessage(tab, message);
    } catch (error) {
      // No content script: a tab from before the install, or a page Iris can't read.
      const { url } = await api.tabs.get(tab);
      if (injected.has(tab) || !api.scripting || !isReadableUrl(url)) throw error;
      injected.add(tab);
      await api.scripting.executeScript({ target: { tabId: tab }, files: [CONTENT_SCRIPT_FILE] });
      reply = await api.tabs.sendMessage(tab, message);
    }
    const typed = reply as ContentReply<T> | undefined;
    if (!typed) throw new Error('The page did not answer');
    if (!typed.ok) throw new Error(typed.error);
    return typed.value;
  }

  return {
    getSnapshot: () => send<PageSnapshot>({ type: 'iris/get-snapshot' }),
    highlight: (request) => send<HighlightResult>({ type: 'iris/highlight', request }),
    clearHighlights: () => send<undefined>({ type: 'iris/clear-highlights' }),
    showChip: (request) => send<undefined>({ type: 'iris/show-chip', request }),
    hideChips: () => send<undefined>({ type: 'iris/hide-chips' }),
    describeElement: (id) => send<ElementDescription | null>({ type: 'iris/describe-element', id }),
    overlayRects: () => send<OverlayRect[]>({ type: 'iris/overlay-rects' }),
    pointerHint: () => send<PointerHint | null>({ type: 'iris/pointer-hint' }),
    onPageEvent(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    dispose() {
      api.runtime.onMessage.removeListener(onMessage);
      listeners.clear();
    },
  };
}
