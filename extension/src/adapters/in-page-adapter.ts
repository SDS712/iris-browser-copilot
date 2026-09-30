/** The widget's adapter: calls the page layer directly. */
import type { PageRuntime } from '../page/runtime';
import type { PageAdapter } from './page-adapter';

export function inPageAdapter(runtime: PageRuntime): PageAdapter {
  return {
    getSnapshot: () => runtime.getSnapshot(),
    highlight: (request) => Promise.resolve(runtime.highlight(request)),
    clearHighlights: () => {
      runtime.clearHighlights();
      return Promise.resolve();
    },
    showChip: (request) => {
      runtime.showChip(request);
      return Promise.resolve();
    },
    hideChips: () => {
      runtime.hideChips();
      return Promise.resolve();
    },
    describeElement: (id) => Promise.resolve(runtime.describeElement(id)),
    overlayRects: () => Promise.resolve(runtime.overlayRects()),
    pointerHint: () => Promise.resolve(runtime.pointerHint()),
    onPageEvent: (callback) => runtime.onPageEvent(callback),
  };
}
