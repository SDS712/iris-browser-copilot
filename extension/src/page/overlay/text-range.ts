/**
 * Finds quoted text in the page: walk the text nodes of a section, match after
 * normalising whitespace, quotes and dashes, and build a Range over the original nodes.
 */
import { IRIS_HOSTS } from '../labels';
import type { SectionBounds } from '../reader';

const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'TEXTAREA',
  'SELECT',
  ...IRIS_HOSTS,
]);

function normaliseChar(ch: string): string {
  if (/\s/.test(ch)) return ' ';
  if (/[‘’‛′`]/.test(ch)) return "'";
  if (/[“”„″]/.test(ch)) return '"';
  if (/[‐‑‒–—―−]/.test(ch)) return '-';
  if (ch === '…') return '.';
  return ch.toLowerCase();
}

export function normaliseQuote(text: string): string {
  return Array.from(text, normaliseChar).join('').replace(/ +/g, ' ').trim();
}

function textNodes(bounds: SectionBounds): Text[] {
  const doc = bounds.anchor.ownerDocument;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let el = node.parentElement; el; el = el.parentElement) {
        if (SKIP.has(el.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  walker.currentNode = bounds.anchor;
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (
      bounds.end &&
      !(bounds.end.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING)
    ) {
      break;
    }
    nodes.push(node as Text);
  }
  return nodes;
}

interface Position {
  node: Text;
  offset: number;
}

/**
 * A Range over `quote` inside the section, or null when it isn't there. Whitespace is left
 * out of the comparison altogether: text split across inline elements (a linked email, a
 * bold word) has no reliable spacing between the nodes.
 */
export function findQuoteRange(bounds: SectionBounds, quote: string): Range | null {
  const wanted = normaliseQuote(quote).replace(/ /g, '');
  if (!wanted) return null;
  let text = '';
  const positions: Position[] = [];
  for (const node of textNodes(bounds)) {
    const data = node.data;
    for (let offset = 0; offset < data.length; offset += 1) {
      const ch = normaliseChar(data[offset] ?? '');
      if (ch === ' ') continue;
      text += ch;
      positions.push({ node, offset });
    }
  }
  let start = text.indexOf(wanted);
  let length = wanted.length;
  if (start < 0 && wanted.length > 60) {
    // Models sometimes change the end of a long quote; the opening words still locate it.
    const head = wanted.slice(0, 60);
    start = text.indexOf(head);
    length = head.length;
  }
  if (start < 0) return null;
  const first = positions[start];
  const last = positions[start + length - 1];
  if (!first || !last) return null;
  const range = bounds.anchor.ownerDocument.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, Math.min(last.offset + 1, last.node.data.length));
  return range;
}

/** The whole section, from its heading to the next section. */
export function sectionRange(bounds: SectionBounds): Range {
  const doc = bounds.anchor.ownerDocument;
  const range = doc.createRange();
  range.setStartBefore(bounds.anchor);
  if (bounds.end && bounds.end.isConnected) range.setEndBefore(bounds.end);
  else if (doc.body.lastChild) range.setEndAfter(doc.body.lastChild);
  return range;
}
