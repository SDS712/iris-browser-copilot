/** Ring geometry: the element's box plus 4 px, following its corners. */
import type { Layout, Rect } from '../layout';

export const RING_GAP = 4;

export function union(rects: Rect[]): Rect | null {
  const visible = rects.filter((r) => r.width > 0 || r.height > 0);
  if (visible.length === 0) return null;
  const left = Math.min(...visible.map((r) => r.x));
  const top = Math.min(...visible.map((r) => r.y));
  const right = Math.max(...visible.map((r) => r.x + r.width));
  const bottom = Math.max(...visible.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function grow(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2,
  };
}

/** The element's box; a checkbox or radio also takes in its labels ("the checkbox and its label"). */
export function targetRect(el: Element, layout: Layout): Rect | null {
  const rects = [layout.rect(el)];
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    for (const label of Array.from(el.labels ?? [])) rects.push(layout.rect(label));
  }
  return union(rects);
}

export function ringRadius(el: Element, layout: Layout): number {
  const radius = Number.parseFloat(layout.style(el).borderTopLeftRadius) || 0;
  return Math.min(radius, 24) + RING_GAP;
}
