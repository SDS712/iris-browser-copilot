/**
 * Scrolling a highlighted item into view: to the middle of
 * the part of the viewport that sticky headers, fixed banners and the widget don't cover.
 */
import { IRIS_HOSTS } from '../labels';
import type { Layout, Rect } from '../layout';

interface Band {
  top: number;
  bottom: number;
}

function fixedAncestor(el: Element, layout: Layout): Element | null {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
    if (IRIS_HOSTS.has(node.tagName.toUpperCase())) return null;
    const position = layout.style(node).position;
    if (position === 'fixed' || position === 'sticky') return node;
  }
  return null;
}

/** A fixed or sticky bar spanning at least half the width at height `y`, if any. */
function barAt(doc: Document, y: number, layout: Layout): Rect | null {
  const width = doc.documentElement.clientWidth;
  for (const x of [width * 0.25, width * 0.5, width * 0.75]) {
    for (const el of doc.elementsFromPoint(x, y)) {
      const bar = fixedAncestor(el, layout);
      if (!bar) continue;
      const rect = layout.rect(bar);
      if (rect.width >= width * 0.5) return rect;
    }
  }
  return null;
}

/** The vertical band of the viewport that nothing fixed covers. */
export function freeBand(doc: Document, layout: Layout, avoid: Rect[]): Band {
  const height = doc.documentElement.clientHeight;
  const width = doc.documentElement.clientWidth;
  let top = 0;
  for (let i = 0; i < 4; i += 1) {
    const bar = barAt(doc, top + 1, layout);
    if (!bar || bar.y + bar.height <= top || bar.height > height * 0.4) break;
    top = bar.y + bar.height;
  }
  let bottom = height;
  for (let i = 0; i < 4; i += 1) {
    const bar = barAt(doc, bottom - 1, layout);
    if (!bar || bar.y >= bottom || bar.height > height * 0.5) break;
    bottom = bar.y;
  }
  for (const rect of avoid) {
    // A bottom sheet (the widget on a phone) covers the lower part of the page.
    if (rect.width >= width * 0.6 && rect.y > top) bottom = Math.min(bottom, rect.y);
  }
  return { top, bottom: Math.max(bottom, top + 1) };
}

function scrollableAncestor(el: Element, layout: Layout): Element | null {
  const doc = el.ownerDocument;
  for (
    let node = el.parentElement;
    node && node !== doc.body && node !== doc.documentElement;
    node = node.parentElement
  ) {
    const style = layout.style(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

function settle(win: Window, smooth: boolean): Promise<void> {
  return new Promise((resolve) => {
    if (!smooth) {
      win.requestAnimationFrame(() => {
        resolve();
      });
      return;
    }
    const done = () => {
      win.removeEventListener('scrollend', done, true);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 700);
    win.addEventListener('scrollend', done, true);
  });
}

/** Scrolls so `measure()` sits in the middle of the free band. Resolves when scrolling ends. */
export async function scrollToFree(
  el: Element,
  measure: () => Rect | null,
  options: { layout: Layout; avoid: Rect[]; smooth: boolean },
): Promise<void> {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const rect = measure();
  if (!win || !rect) return;
  const band = freeBand(doc, options.layout, options.avoid);
  if (rect.y >= band.top && rect.y + rect.height <= band.bottom) return;
  const behavior: ScrollBehavior = options.smooth ? 'smooth' : 'auto';
  if (scrollableAncestor(el, options.layout)) {
    el.scrollIntoView({ block: 'center', behavior });
    await settle(win, options.smooth);
    return;
  }
  const bandHeight = band.bottom - band.top;
  const delta =
    rect.height > bandHeight - 32
      ? rect.y - band.top - 16
      : rect.y + rect.height / 2 - (band.top + band.bottom) / 2;
  if (Math.abs(delta) < 2) return;
  win.scrollBy({ top: delta, behavior });
  await settle(win, options.smooth);
}
