/**
 * The background service worker: opens the panel from the toolbar icon, keeps
 * the toolbar badge, handles the keyboard command, and holds chip taps made while the panel
 * was closed until the panel collects them.
 */
import {
  badgeFor,
  fromThisExtension,
  isContentReport,
  isPanelRequest,
  PANEL_PORT,
  type PanelNotice,
  type PendingIntent,
} from './messages';

interface Port {
  name: string;
  postMessage(message: PanelNotice): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
  sender?: { id?: string };
}

type Sender = { id?: string; tab?: { id?: number; windowId?: number } };

export interface BackgroundApi {
  runtime: {
    id: string;
    onInstalled: { addListener(listener: () => void): void };
    onConnect: { addListener(listener: (port: Port) => void): void };
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: Sender,
          sendResponse: (reply: unknown) => void,
        ) => boolean | undefined,
      ): void;
    };
  };
  sidePanel: {
    setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
    open(options: { tabId?: number; windowId?: number }): Promise<void>;
  };
  action: {
    setBadgeText(details: { tabId: number; text: string }): Promise<void>;
    setBadgeBackgroundColor(details: { tabId: number; color: string }): Promise<void>;
  };
  tabs: {
    onUpdated: {
      addListener(listener: (tabId: number, change: { status?: string }) => void): void;
    };
  };
  commands: {
    onCommand: {
      addListener(
        listener: (command: string, tab?: { id?: number; windowId?: number }) => void,
      ): void;
    };
  };
}

interface Panel {
  port: Port;
  windowId: number;
  tabId: number | null;
}

export function startBackground(api: BackgroundApi): void {
  const panels = new Set<Panel>();
  // Chip taps and commands made while no panel was open, by window.
  const intents = new Map<number, PendingIntent>();

  api.runtime.onInstalled.addListener(() => {
    void api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  });

  const panelFor = (windowId: number | undefined) =>
    [...panels].find((panel) => panel.windowId === windowId) ?? null;

  api.runtime.onConnect.addListener((port) => {
    if (port.name !== PANEL_PORT || !fromThisExtension(port.sender ?? {}, api.runtime.id)) return;
    const panel: Panel = { port, windowId: -1, tabId: null };
    panels.add(panel);
    port.onMessage.addListener((message) => {
      if (!isPanelRequest(message) || message.type !== 'iris/attach') return;
      panel.windowId = message.windowId;
      panel.tabId = message.tabId;
      if (intents.has(message.windowId)) port.postMessage({ type: 'iris/intent' });
    });
    port.onDisconnect.addListener(() => {
      panels.delete(panel);
    });
  });

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!fromThisExtension(sender, api.runtime.id)) return undefined;
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    if (isPanelRequest(message) && message.type === 'iris/take-intent') {
      sendResponse(intents.get(message.windowId) ?? null);
      intents.delete(message.windowId);
      return undefined;
    }
    if (!isContentReport(message) || tabId === undefined) return undefined;
    switch (message.type) {
      case 'iris/flag-counts': {
        const badge = badgeFor(message.high, message.medium);
        void api.action.setBadgeText({ tabId, text: badge.text });
        void api.action.setBadgeBackgroundColor({ tabId, color: badge.color });
        return undefined;
      }
      case 'iris/panel-attached':
        sendResponse([...panels].some((panel) => panel.tabId === tabId));
        return undefined;
      case 'iris/chip-clicked': {
        if (windowId === undefined) return undefined;
        intents.set(windowId, { tabId, kind: message.kind, element_id: message.element_id });
        // Called straight away, inside the user's click, or Chrome refuses to open it.
        api.sidePanel.open({ tabId }).then(
          () => {
            sendResponse({ opened: true });
          },
          () => {
            sendResponse({ opened: false });
          },
        );
        return true;
      }
      default:
        return undefined;
    }
  });

  api.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading') void api.action.setBadgeText({ tabId, text: '' });
  });

  api.commands.onCommand.addListener((command, tab) => {
    if (command !== 'toggle-iris' || tab?.windowId === undefined) return;
    const panel = panelFor(tab.windowId);
    if (panel) {
      panel.port.postMessage({ type: 'iris/command', command: 'toggle-iris' });
      return;
    }
    intents.set(tab.windowId, { tabId: tab.id ?? -1, kind: 'toggle', element_id: null });
    void api.sidePanel.open({ windowId: tab.windowId });
  });
}
