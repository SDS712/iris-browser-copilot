/**
 * The content script: reads and draws on the page, and never calls the
 * backend. With the side panel closed, nothing leaves the browser: the client checks still
 * run, so the toolbar badge and the page's chips work, and chips are decided here.
 */
import type { ChipKind, PageEvent } from '../adapters/page-adapter';
import { chipForPageEvent, chipForRisks, mayReplaceChip } from '../core/nudges';
import { DEFAULT_SETTINGS, extensionSettings, type StorageArea } from '../core/settings';
import { PageRuntime } from '../page/runtime';
import { loadIrisFonts } from '../ui/fonts';
import {
  fromThisExtension,
  isContentRequest,
  type ContentReply,
  type ContentReport,
  type ContentRequest,
} from './messages';

export interface ContentApi {
  runtime: {
    id: string;
    getURL(path: string): string;
    sendMessage(message: ContentReport): Promise<unknown>;
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: { id?: string },
          sendResponse: (reply: ContentReply<unknown>) => void,
        ) => boolean | undefined,
      ): void;
    };
  };
  storage: { local: StorageArea };
}

const OPEN_FROM_TOOLBAR = 'Open Iris from the toolbar';

declare global {
  // Set once per page, so a second injection (after an install) doesn't run twice.
  var __irisContentScript: boolean | undefined;
}

export function startContentScript(api: ContentApi, debug: boolean): PageRuntime | null {
  if (globalThis.__irisContentScript) return null;
  globalThis.__irisContentScript = true;

  loadIrisFonts((file) => api.runtime.getURL(`/fonts/${file}`));
  const runtime = new PageRuntime();
  const settings = extensionSettings(api.storage.local);
  let localChip: ChipKind | null = null;

  const report = (message: ContentReport) =>
    api.runtime.sendMessage(message).catch(() => undefined);

  /** When the panel follows this tab, its nudge engine owns the chips. */
  const panelAttached = async () =>
    (await api.runtime.sendMessage({ type: 'iris/panel-attached' }).catch(() => false)) === true;

  async function decideChip(event: PageEvent): Promise<void> {
    const chip =
      event.type === 'page-changed'
        ? chipForRisks(runtime.lastSnapshot()?.client_flags ?? [])
        : chipForPageEvent(event);
    if (!chip) return;
    const { nudges } = await settings.load().catch(() => DEFAULT_SETTINGS);
    if (!nudges || (await panelAttached()) || !mayReplaceChip(localChip, chip.kind)) return;
    localChip = chip.kind;
    runtime.showChip(chip);
  }

  async function chipTapped(kind: ChipKind, elementId: string): Promise<void> {
    if (await panelAttached()) return;
    const reply = await api.runtime
      .sendMessage({ type: 'iris/chip-clicked', kind, element_id: elementId })
      .catch(() => null);
    const opened = typeof reply === 'object' && reply !== null && 'opened' in reply && reply.opened;
    // Chrome may not open the panel from a click passed on by a content script.
    if (!opened) runtime.highlight({ ids: [elementId], note: OPEN_FROM_TOOLBAR, level: 'normal' });
  }

  runtime.onPageEvent((event) => {
    void report({ type: 'iris/page-event', event });
    if (event.type === 'page-changed')
      void report({ type: 'iris/flag-counts', ...runtime.flagCounts() });
    if (event.type === 'chip-hidden') localChip = null;
    if (event.type === 'chip-clicked') {
      localChip = null;
      void chipTapped(event.kind, event.element_id);
      return;
    }
    void decideChip(event);
  });

  async function handle(request: ContentRequest): Promise<unknown> {
    switch (request.type) {
      case 'iris/get-snapshot':
        return runtime.getSnapshot();
      case 'iris/highlight':
        return runtime.highlight(request.request);
      case 'iris/clear-highlights':
        runtime.clearHighlights();
        return null;
      case 'iris/show-chip':
        runtime.showChip(request.request);
        return null;
      case 'iris/hide-chips':
        runtime.hideChips();
        return null;
      case 'iris/describe-element':
        return runtime.describeElement(request.id);
      case 'iris/overlay-rects':
        return runtime.overlayRects();
      case 'iris/pointer-hint':
        return runtime.pointerHint();
    }
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only this extension's own pages talk to the content script, never the web page.
    if (!fromThisExtension(sender, api.runtime.id) || !isContentRequest(message)) return undefined;
    handle(message).then(
      (value) => {
        sendResponse({ ok: true, value });
      },
      (error: unknown) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return true;
  });

  if (debug) startDebugBridge(runtime);
  runtime.start();
  return runtime;
}

/**
 * Debug builds only: page-side calls for tests, over window.postMessage.
 * Never part of a normal build: the page can't reach the content script otherwise.
 */
function startDebugBridge(runtime: PageRuntime): void {
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data as { source?: string; id?: number; call?: string; arg?: string } | null;
    if (event.source !== window || data?.source !== 'iris-debug') return;
    const reply = (result: unknown) => {
      window.postMessage({ source: 'iris-debug-reply', id: data.id, result }, '*');
    };
    if (data.call === 'lastSnapshot') void runtime.getSnapshot().then(reply);
    else if (data.call === 'overlayRects') reply(runtime.overlayRects());
    else if (data.call === 'describeElement') reply(runtime.describeElement(data.arg ?? ''));
  });
}
