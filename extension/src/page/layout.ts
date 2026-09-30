/**
 * Layout reads, behind one small interface so unit tests (happy-dom has no layout engine)
 * can supply sizes. Nothing here writes to the page.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  /** Not display:none or visibility:hidden, here or above. Size isn't checked. */
  displayed(el: Element): boolean;
  rect(el: Element): Rect;
  style(el: Element): CSSStyleDeclaration;
}

/** The style-based check, for engines without Element.checkVisibility (and unit tests). */
export function displayedByStyle(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  if (view.getComputedStyle(el).visibility === 'hidden') return false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || view.getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

export const browserLayout: Layout = {
  displayed(el) {
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ visibilityProperty: true });
    }
    return displayedByStyle(el);
  },
  rect(el) {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  },
  style(el) {
    const view = el.ownerDocument.defaultView;
    if (!view) throw new Error('Element has no window');
    return view.getComputedStyle(el);
  },
};

/** Visible for the reader: displayed and with a non-zero size. */
export function isRendered(layout: Layout, el: Element): boolean {
  if (!layout.displayed(el)) return false;
  const rect = layout.rect(el);
  return rect.width > 0 && rect.height > 0;
}
