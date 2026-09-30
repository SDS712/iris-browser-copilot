/**
 * Starts the web widget: the <iris-widget> host at the end of <body>, the
 * page runtime with the in-page adapter, and the pill. Chips and client checks work at
 * once; nothing is sent to the backend until the panel is opened.
 */
import { signal } from '@preact/signals';
import { render } from 'preact';
import { inPageAdapter } from '../adapters/in-page-adapter';
import { createApi } from '../core/api';
import { createIrisApp, type IrisApp } from '../core/app';
import { installDebug } from '../core/debug';
import { sessionJourneyStorage } from '../core/journey';
import { sessionSites } from '../core/trust-watch';
import { DEFAULT_SETTINGS, localSettings } from '../core/settings';
import { PageRuntime } from '../page/runtime';
import { WidgetShell } from '../ui/components/WidgetShell';
import { AppContext } from '../ui/context';
import { loadIrisFonts } from '../ui/fonts';
import { IRIS_CSS } from '../ui/styles';
import widgetCss from '../ui/styles/widget.css?inline';
import { saveHandover, takeHandover, watchLeaving } from './handover';

export interface WidgetOptions {
  apiBase: string;
  /** Where pcm-worklet.js and fonts/ are (next to the script). */
  assetUrl: (path: string) => string;
  nudges: boolean;
  open: boolean;
  mockVoice: boolean;
  debug: boolean;
}

/** window.Iris. Plain functions, so they can be passed around. */
export interface IrisHandle {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

export interface Widget extends IrisHandle {
  app: IrisApp;
  runtime: PageRuntime;
}

const IRIS_HOSTS = new Set(['IRIS-WIDGET', 'IRIS-OVERLAY']);

/**
 * How far the collapsed pill must rise to sit above a fixed bar along the bottom of the page
 * (a cookie banner, a sticky checkout bar), so it never covers the page's own buttons.
 */
export function barHeightUnderPill(doc: Document = document): number {
  const width = doc.documentElement.clientWidth;
  const height = doc.documentElement.clientHeight;
  let lift = 0;
  for (const x of [width - 40, width - 160]) {
    for (const hit of doc.elementsFromPoint(x, height - 30)) {
      if (IRIS_HOSTS.has(hit.tagName)) continue;
      for (let el: Element | null = hit; el; el = el.parentElement) {
        const position = getComputedStyle(el).position;
        if (position !== 'fixed' && position !== 'sticky') continue;
        const rect = el.getBoundingClientRect();
        if (rect.bottom >= height - 2 && rect.height < height * 0.5)
          lift = Math.max(lift, height - rect.top);
        break;
      }
      break;
    }
  }
  return lift;
}

export function startWidget(options: WidgetOptions): Widget {
  loadIrisFonts((file) => options.assetUrl(`fonts/${file}`));
  const host = document.createElement('iris-widget');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
  document.body.append(host);
  // Closed, so the page can't reach into Iris; open when debugging, so tests can.
  const shadow = host.attachShadow({ mode: options.debug ? 'open' : 'closed' });
  const style = document.createElement('style');
  style.textContent = `${IRIS_CSS}\n${widgetCss}`;
  const root = document.createElement('div');
  root.className = 'iris-root iris-widget';
  shadow.append(style, root);

  const isOpen = signal(false);
  const runtime = new PageRuntime({
    // Esc on the page clears the highlights and stops Iris's audio too.
    onEscape: () => {
      app.session.stopAudio();
    },
    // Highlights stay clear of the widget.
    avoid: () => {
      const rect = root.getBoundingClientRect();
      return rect.width > 0
        ? [{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }]
        : [];
    },
  });
  let started = false;
  const handle: IrisHandle = {
    open: () => {
      isOpen.value = true;
      root.style.bottom = '';
      root.classList.add('iris-widget--open');
      if (!started) {
        started = true;
        void app.openPage();
      }
    },
    close: () => {
      isOpen.value = false;
      root.classList.remove('iris-widget--open');
      placePill();
    },
    isOpen: () => isOpen.value,
  };
  const app = createIrisApp({
    api: createApi(options.apiBase),
    platform: {
      kind: 'widget',
      settings: localSettings({ ...DEFAULT_SETTINGS, nudges: options.nudges }),
      minimise: handle.close,
      open: handle.open,
      keepAcrossPageLoads: {
        shouldKeep: watchLeaving(),
        save: (handover) => {
          saveHandover(handover, app.store.session.muted.value);
        },
      },
    },
    mockVoice: options.mockVoice,
    debug: options.debug,
    workletUrl: options.assetUrl('pcm-worklet.js'),
    adapter: inPageAdapter(runtime),
    // Per tab and kept across page loads, like the session itself.
    journeyStorage: sessionJourneyStorage(),
    checkedSites: sessionSites(),
  });
  render(
    <AppContext.Provider value={app}>
      <WidgetShell open={isOpen} onOpen={handle.open} />
    </AppContext.Provider>,
    root,
  );
  // The collapsed pill stays clear of the page's fixed bottom bars.
  function placePill(): void {
    if (isOpen.value) {
      root.style.bottom = '';
      return;
    }
    const lift = barHeightUnderPill();
    root.style.bottom = lift > 0 ? `${String(lift + 12)}px` : '';
  }
  window.addEventListener('resize', placePill, { passive: true });
  runtime.onPageEvent((event) => {
    if (event.type === 'page-changed') placePill();
  });
  runtime.start();
  requestAnimationFrame(placePill);
  if (options.debug) {
    installDebug(app, {
      describeElement: (id) => runtime.describeElement(id),
      overlayRects: () => runtime.overlayRects(),
    });
  }
  const handover = takeHandover();
  if (handover) {
    // The previous page of this site handed its session over: carry on without a greeting.
    handle.open();
    app.store.session.muted.value = handover.muted;
    app.continueSession(handover);
    // The browser may hold the audio until a click; the user asked for no prompt.
    const wake = () => {
      void app.resumeAudio();
    };
    for (const type of ['pointerdown', 'keydown'] as const) {
      document.addEventListener(type, wake, { capture: true, once: true, passive: true });
    }
  } else if (options.open) handle.open();
  return { ...handle, app, runtime };
}
