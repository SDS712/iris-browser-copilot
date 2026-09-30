/**
 * The side panel: the Iris interface for the active tab of this window. It
 * holds the voice session, the backend calls and the cards; the content script reads and
 * draws on the page.
 */
import { browser } from 'wxt/browser';
import { extensionAdapter, type ExtensionApi } from '../adapters/extension-adapter';
import { createApi } from '../core/api';
import { createIrisApp } from '../core/app';
import { installDebug } from '../core/debug';
import { extensionSettings } from '../core/settings';
import { loadIrisFonts } from '../ui/fonts';
import { mountPanel } from '../ui/mount';
import { isPanelNotice, PANEL_PORT, type PendingIntent } from './messages';
import { TabJourneys, TabMemory } from './tab-memory';

/** Files added by the build hook (worklet, fonts) aren't in WXT's generated path types. */
const extensionUrl = (path: string): string =>
  (browser.runtime.getURL as (path: string) => string)(path);

export interface PanelFlags {
  apiBase: string;
  mockVoice: boolean;
  debug: boolean;
}

async function commandShortcut(): Promise<string | undefined> {
  const commands = await browser.commands.getAll().catch(() => []);
  return commands.find((command) => command.name === 'toggle-iris')?.shortcut || undefined;
}

/** The microphone permission view until the extension's origin has the mic. */
async function watchMicrophone(onGranted: (granted: boolean) => void): Promise<void> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    onGranted(status.state === 'granted');
    status.onchange = () => {
      onGranted(status.state === 'granted');
    };
  } catch {
    onGranted(true);
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'mic_granted_at' in changes) onGranted(true);
  });
}

export async function startPanel(root: HTMLElement, flags: PanelFlags): Promise<void> {
  loadIrisFonts((file) => extensionUrl(`/fonts/${file}`));
  const win = await browser.windows.getCurrent();
  const windowId = win.id ?? -1;
  // Debug builds can follow a given tab (sidepanel.html?tabId=N), so tests can open the panel in a tab.
  const fixedTab = flags.debug
    ? Number(new URLSearchParams(location.search).get('tabId')) || null
    : null;
  const activeTab = async () =>
    (await browser.tabs.query({ active: true, windowId }))[0]?.id ?? null;
  let tabId: number | null = fixedTab ?? (await activeTab());

  const adapter = extensionAdapter(browser as unknown as ExtensionApi, () => tabId);
  const journeys = new TabJourneys(() => tabId);
  const app = createIrisApp({
    api: createApi(flags.apiBase),
    platform: {
      kind: 'extension',
      settings: extensionSettings(browser.storage.local),
      openMicPermission: () => {
        void browser.tabs.create({ url: extensionUrl('/mic-permission.html') });
      },
      close: () => {
        window.close();
      },
      shortcut: await commandShortcut(),
    },
    mockVoice: flags.mockVoice,
    debug: flags.debug,
    workletUrl: extensionUrl('/pcm-worklet.js'),
    adapter,
    journeyStorage: journeys.storage,
  });
  const context = app.context;
  if (!context) return;
  const memory = new TabMemory(app.store, context);
  app.nudges?.useDocument(`tab:${String(tabId)}`);

  const port = browser.runtime.connect({ name: PANEL_PORT });
  const attach = () => {
    port.postMessage({ type: 'iris/attach', windowId, tabId });
  };
  attach();

  async function takeIntent(): Promise<void> {
    const intent = (await browser.runtime
      .sendMessage({ type: 'iris/take-intent', windowId })
      .catch(() => null)) as PendingIntent | null;
    if (!intent) return;
    if (intent.kind === 'toggle') app.talk();
    else if (intent.element_id && intent.tabId === tabId) {
      app.nudges?.onPageEvent({
        type: 'chip-clicked',
        kind: intent.kind,
        element_id: intent.element_id,
      });
    }
  }

  port.onMessage.addListener((message: unknown) => {
    if (!isPanelNotice(message)) return;
    if (message.type === 'iris/command') app.talk();
    else void takeIntent();
  });

  const switchTo = (next: number) => {
    if (next === tabId) return;
    if (tabId !== null) memory.save(tabId);
    tabId = next;
    attach();
    memory.restore(next);
    app.nudges?.useDocument(`tab:${String(next)}`);
    // The session carries on across tabs: the new page's context goes into it.
    void app.refreshPage().then(() => {
      context.sendPageContext();
    });
  };

  if (!fixedTab) {
    browser.tabs.onActivated.addListener((info) => {
      if (info.windowId === windowId) switchTo(info.tabId);
    });
  }
  browser.tabs.onUpdated.addListener((id, change) => {
    if (id !== tabId) return;
    // A new document in this tab: its content script reports the page once it's read.
    if (change.status === 'loading' && change.url) context.forget();
    if (change.status === 'complete') void app.refreshPage();
  });
  browser.tabs.onRemoved.addListener((id) => {
    memory.forget(id);
    journeys.forget(id);
  });

  void watchMicrophone((granted) => {
    app.onMicPermission(granted);
  });

  mountPanel(root, app);
  if (flags.debug) {
    installDebug(app, {
      describeElement: (id) => adapter.describeElement(id),
      overlayRects: () => adapter.overlayRects(),
    });
  }
  await app.openPage();
  await takeIntent();
}
