/**
 * Marker geometry: one yellow box per line of the quoted text, with
 * 2 px padding, and lower opacity on dark pages.
 */
import type { Layout, Rect } from '../layout';

const LINE_TOLERANCE = 3;

/**
 * The rects of the text inside a range, one per text node and line. Measuring text nodes
 * (not the range itself) leaves out whole block boxes, so markers hug the words.
 */
function textRects(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer;
  const doc = root.ownerDocument ?? document;
  const nodes: Text[] = [];
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root as Text);
  else {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (range.intersectsNode(node) && (node.textContent ?? '').trim()) nodes.push(node as Text);
    }
  }
  const rects: DOMRect[] = [];
  for (const node of nodes) {
    const part = doc.createRange();
    part.setStart(node, node === range.startContainer ? range.startOffset : 0);
    part.setEnd(node, node === range.endContainer ? range.endOffset : node.length);
    rects.push(...Array.from(part.getClientRects()));
  }
  return rects;
}

/** Merges the text's rects into one rect per line. */
export function lineRects(range: Range): Rect[] {
  const lines: Rect[] = [];
  for (const r of textRects(range)) {
    if (r.width < 1 || r.height < 1) continue;
    const line = lines.find(
      (l) =>
        Math.abs(l.y - r.y) <= LINE_TOLERANCE &&
        Math.abs(l.y + l.height - r.bottom) <= LINE_TOLERANCE,
    );
    if (line) {
      const right = Math.max(line.x + line.width, r.right);
      line.x = Math.min(line.x, r.x);
      line.width = right - line.x;
    } else lines.push({ x: r.x, y: r.y, width: r.width, height: r.height });
  }
  return lines.map((l) => ({ x: l.x - 2, y: l.y - 2, width: l.width + 4, height: l.height + 4 }));
}

function parseColour(value: string): [number, number, number, number] | null {
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (!match?.[1]) return null;
  const parts = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  const [r = 0, g = 0, b = 0, a = 1] = parts;
  return [r, g, b, a];
}

function luminance([r, g, b]: [number, number, number, number]): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** True when the first opaque background behind the element has luminance under 0.2. */
export function onDarkBackground(el: Element, layout: Layout): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const colour = parseColour(layout.style(node).backgroundColor);
    if (colour && colour[3] > 0.5) return luminance(colour) < 0.2;
  }
  return false;
}
