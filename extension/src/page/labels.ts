/**
 * Label, help-text and text resolution for the reader. Text comes from the
 * page's own words only; form controls are skipped, so no field value is ever included.
 */
import type { Layout } from './layout';
import type { FormControl } from './privacy';

export const IRIS_HOSTS = new Set(['IRIS-OVERLAY', 'IRIS-WIDGET']);

/** Elements whose text is never page text: code, controls, and Iris's own hosts. */
const SKIP_TEXT = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'SELECT',
  'TEXTAREA',
  'INPUT',
  'OPTION',
  'SVG',
  ...IRIS_HOSTS,
]);

export function normaliseWs(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function skipsText(el: Element): boolean {
  return SKIP_TEXT.has(el.tagName.toUpperCase()) || (el as HTMLElement).isContentEditable;
}

/** The visible-words text of an element, without form controls or editable regions. */
export function textOf(root: Node): string {
  if (root.nodeType === Node.TEXT_NODE) return normaliseWs(root.textContent ?? '');
  if (root instanceof Element && skipsText(root)) return '';
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) parts.push(child.textContent ?? '');
      else if (child instanceof Element && !skipsText(child)) {
        if (child.getAttribute('aria-hidden') === 'true') continue;
        walk(child);
        parts.push(' ');
      }
    }
  };
  walk(root);
  return normaliseWs(parts.join(''));
}

function byId(el: Element, id: string): Element | null {
  const root = el.getRootNode() as Document | ShadowRoot;
  return root.getElementById(id);
}

function idrefText(el: Element, attr: string): string {
  const ids = (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean);
  const texts = ids.map((id) => {
    const target = byId(el, id);
    return target ? textOf(target) : '';
  });
  return normaliseWs(texts.join(' '));
}

function labelElement(el: FormControl): HTMLLabelElement | null {
  if (el.id) {
    const root = el.getRootNode() as Document | ShadowRoot;
    for (const label of Array.from(root.querySelectorAll('label'))) {
      if (label.htmlFor === el.id) return label;
    }
  }
  return null;
}

/** Text just before the control in the same row: the nearest preceding sibling text. */
function precedingText(el: Element): string {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 2; depth += 1, node = node.parentElement) {
    for (let sib = node.previousSibling; sib; sib = sib.previousSibling) {
      const text = sib instanceof Element ? textOf(sib) : normaliseWs(sib.textContent ?? '');
      if (text) return text.length <= 200 ? text : '';
    }
  }
  return '';
}

/**
 * The label, in this order: <label for>, a wrapping <label>, aria-label,
 * aria-labelledby, then (for fields that aren't sensitive) the placeholder, then the text
 * just before the control. The placeholder is left to the caller, which knows sensitivity.
 */
export function labelFor(el: FormControl): string {
  const forLabel = labelElement(el);
  if (forLabel) {
    const text = textOf(forLabel);
    if (text) return clip(text, 200);
  }
  const wrapping = el.closest('label');
  if (wrapping) {
    const text = textOf(wrapping);
    if (text) return clip(text, 200);
  }
  const aria = normaliseWs(el.getAttribute('aria-label') ?? '');
  if (aria) return clip(aria, 200);
  const labelledBy = idrefText(el, 'aria-labelledby');
  if (labelledBy) return clip(labelledBy, 200);
  return '';
}

export function fallbackLabel(el: FormControl, allowPlaceholder: boolean): string {
  const placeholder = normaliseWs(el.getAttribute('placeholder') ?? '');
  if (allowPlaceholder && placeholder) return clip(placeholder, 200);
  return clip(precedingText(el), 200);
}

function fontSize(layout: Layout, el: Element): number {
  return Number.parseFloat(layout.style(el).fontSize) || 16;
}

/** aria-describedby text, or small text right after the field (or its label). */
export function helpTextFor(el: FormControl, layout: Layout): string | null {
  const described = idrefText(el, 'aria-describedby');
  if (described) return clip(described, 300);
  const anchor = el.closest('label') ?? el;
  const next = anchor.nextElementSibling;
  if (!next || next.matches('input, select, textarea, label, button')) return null;
  const text = textOf(next);
  if (!text || text.length > 300) return null;
  const small = next.tagName === 'SMALL' || fontSize(layout, next) < fontSize(layout, el);
  return small ? text : null;
}

export function legendOf(el: Element): string | null {
  const fieldset = el.closest('fieldset');
  const legend = fieldset?.querySelector(':scope > legend');
  const text = legend ? textOf(legend) : '';
  return text ? clip(text, 200) : null;
}
