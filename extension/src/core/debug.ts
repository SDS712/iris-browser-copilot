/**
 * window.IrisDebug: test and debug hooks, only in builds or
 * pages that ask for them (?iris_debug=1 in the widget, IRIS_DEBUG=true for the extension).
 */
import type { ElementDescription } from '../adapters/page-adapter';
import type { OverlayRect } from '../page/overlay/overlay';
import type { Card, PageSnapshot, ToolResult } from './api';
import type { IrisApp } from './app';
import type { SessionState } from './store';

type MaybePromise<T> = T | Promise<T>;

export interface IrisDebug {
  getState(): {
    session_state: SessionState;
    page_id: string | null;
    cards: Card[];
    highlight_ids: string[];
    chips: { element_id: string; label: string }[];
    spoken: string[];
    /** Chimes played before Iris spoke up by itself. */
    cues: number;
    /** The walkthrough's current stop, or null. */
    tour: { step: number; total: number; key: string; mode: 'page' | 'form' } | null;
  };
  runTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<ToolResult | Record<string, unknown> | { error: unknown }>;
  refreshSnapshot(): Promise<{ page_id: string; page_type: string }>;
  lastSnapshot(): PageSnapshot | null;
  describeElement(id: string): MaybePromise<ElementDescription | null>;
  overlayRects(): MaybePromise<OverlayRect[]>;
  startSession(): Promise<void>;
  endSession(): Promise<void>;
  /** The tab's journey: page IDs and URLs oldest first, and the summary. */
  journey(): { pages: { page_id: string; url: string }[]; summary: string | null };
}

/** Page-side calls: direct in the widget, forwarded to the content script in the extension. */
export interface DebugPage {
  describeElement(id: string): MaybePromise<ElementDescription | null>;
  overlayRects(): MaybePromise<OverlayRect[]>;
}

declare global {
  interface Window {
    IrisDebug?: IrisDebug;
  }
}

export function installDebug(app: IrisApp, page: DebugPage, win: Window = window): IrisDebug {
  const { store } = app;
  const debug: IrisDebug = {
    getState: () => ({
      session_state: store.session.state.value,
      page_id: store.page.value?.page_id ?? null,
      cards: store.cards.value.flatMap((entry) => (entry.result?.card ? [entry.result.card] : [])),
      highlight_ids: [...store.highlightIds.value],
      chips: store.chips.value.map((chip) => ({ ...chip })),
      spoken: [...store.session.spoken.value],
      cues: store.session.cues.value,
      tour: store.tour.value
        ? {
            step: store.tour.value.index + 1,
            total: store.tour.value.total,
            key: store.tour.value.key,
            mode: app.tourMode() ?? 'page',
          }
        : null,
    }),
    async runTool(name, args = {}) {
      const outcome = await app.runTool(name, args);
      if (outcome.isError) return { error: outcome.agentResult.error };
      if (outcome.toolResult) {
        store.session.spoken.value = [...store.session.spoken.value, outcome.toolResult.say];
        return outcome.toolResult;
      }
      return outcome.agentResult;
    },
    async refreshSnapshot() {
      await app.refreshPage();
      const page = store.page.value;
      if (!page) throw new Error('The page could not be registered.');
      return { page_id: page.page_id, page_type: page.page_type };
    },
    lastSnapshot: () => app.context?.lastSnapshot ?? null,
    describeElement: (id) => page.describeElement(id),
    overlayRects: () => page.overlayRects(),
    startSession: () => app.session.start({ greet: true }),
    endSession: () => app.endSession(),
    journey: () => ({
      pages: app.journey.entries.map((entry) => ({ page_id: entry.page_id, url: entry.url })),
      summary: app.journey.summary,
    }),
  };
  win.IrisDebug = debug;
  return debug;
}
