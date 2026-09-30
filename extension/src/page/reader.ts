/**
 * Builds a PageSnapshot from the visible page in one pass over the
 * DOM. It never writes to the page: IDs live in the registry, and field values are only
 * checked for emptiness.
 */
import type { PageSnapshot } from '../core/api';
import { findAmounts, parseInr, type AmountMatch, type AmountPeriod } from './amounts';
import {
  clip,
  fallbackLabel,
  helpTextFor,
  IRIS_HOSTS,
  labelFor,
  legendOf,
  normaliseWs,
  textOf,
} from './labels';
import { isRendered, type Layout } from './layout';
import { isFilled, isSensitive, type FormControl } from './privacy';
import type { Registry } from './registry';

export type Snapshot = PageSnapshot;
export type SnapshotField = Snapshot['fields'][number];
export type SnapshotChoice = Snapshot['checkboxes'][number];
export type SnapshotButton = Snapshot['buttons'][number];
export type SnapshotPrice = Snapshot['prices'][number];
export type SnapshotSection = Snapshot['sections'][number];
export type SnapshotLink = Snapshot['legal_links'][number];

export const LIMITS = {
  fields: 150,
  choices: 100,
  buttons: 100,
  prices: 100,
  sections: 250,
  legalLinks: 50,
  sectionChars: 4_000,
  snapshotBytes: 400_000,
} as const;

/** Unheaded text is grouped into sections of about this size. */
const UNHEADED_CHARS = 800;
/** An amount in a block longer than this is prose, not a price row. */
export const PRICE_ROW_CHARS = 150;

const SKIP_SUBTREE = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'IFRAME',
  'FRAME',
  'OBJECT',
  'EMBED',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'SVG',
  'HEAD',
  ...IRIS_HOSTS,
]);
const HEADINGS: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4 };
const NON_FIELD_INPUTS = new Set([
  'hidden',
  'submit',
  'button',
  'image',
  'reset',
  'checkbox',
  'radio',
]);
const FIELD_TYPES: Record<string, SnapshotField['type']> = {
  text: 'text',
  search: 'text',
  email: 'email',
  tel: 'tel',
  number: 'number',
  date: 'date',
  password: 'password',
};
const LEGAL_RE = /terms|conditions|privacy|agreement|policy/i;
const CLOCK_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;
const ACCEPT_RE = /accept|agree|allow/i;
const REJECT_RE = /reject|decline|deny|necessary only/i;
const MANAGE_RE = /manage|preferences|settings|choices|customi[sz]e/i;

/** What the rules need about a price beyond the snapshot. */
export interface PriceMeta {
  period: AmountPeriod | null;
  sectionId: string | null;
  /** The whole row as shown ("QuickCred Plus: free for 30 days, then ₹199/month"). */
  rowText: string;
  /** Revision in which this label (or amount) was first seen on this document. */
  labelFirstRevision: number;
  amountFirstRevision: number;
}

export interface SectionBounds {
  anchor: Element;
  /** The next section's anchor, or null at the end of the page. */
  end: Element | null;
}

export interface ReadResult {
  /** Everything but client_flags and page_type_hint, which the rules add. */
  snapshot: Snapshot;
  prices: Map<string, PriceMeta>;
  sections: Map<string, SectionBounds>;
  /** Elements showing a clock ("09:59") near words like "ends" or "left". */
  clockCandidates: Element[];
}

interface OpenSection {
  anchor: Element;
  id: string;
  heading: string | null;
  level: number | null;
  parts: string[];
  length: number;
}

interface WalkState {
  revision: number;
  fields: SnapshotField[];
  choices: SnapshotChoice[];
  buttons: SnapshotButton[];
  prices: SnapshotPrice[];
  priceMeta: Map<string, PriceMeta>;
  priceElements: Set<Element>;
  links: SnapshotLink[];
  buttonElements: Map<string, Element>;
  sections: {
    anchor: Element;
    id: string;
    heading: string | null;
    level: number | null;
    text: string;
  }[];
  current: OpenSection | null;
  headingText: string | null;
  inHeading: number;
  inInteractive: number;
  inChoiceLabel: number;
  clocks: Element[];
  truncated: boolean;
}

function isBlockDisplay(display: string): boolean {
  return !display.startsWith('inline') && display !== 'contents' && display !== '';
}

function isChoiceInput(el: Element | null | undefined): el is HTMLInputElement {
  return el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');
}

function splitText(text: string, max: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const sentence = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
    );
    const cut = sentence > max * 0.5 ? sentence + 1 : Math.max(window.lastIndexOf(' '), max * 0.5);
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export class Reader {
  /** Revision in which each ID was first seen visible. */
  private firstSeen = new Map<string, number>();
  private initialChecked = new WeakMap<Element, boolean>();
  private interacted = new WeakSet<Element>();
  private labelFirstRevision = new Map<string, number>();
  private amountFirstRevision = new Map<number, number>();

  constructor(
    private readonly registry: Registry,
    private readonly layout: Layout,
    private readonly doc: Document = document,
  ) {}

  /** Marks choices the user has touched, so they stop counting as pre-checked. */
  trackInteraction(): () => void {
    const note = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (isChoiceInput(target)) this.interacted.add(target);
      const label = target.closest('label');
      if (label && isChoiceInput(label.control)) this.interacted.add(label.control);
    };
    const options = { capture: true, passive: true };
    for (const type of ['pointerdown', 'keydown', 'change']) {
      this.doc.addEventListener(type, note, options);
    }
    return () => {
      for (const type of ['pointerdown', 'keydown', 'change']) {
        this.doc.removeEventListener(type, note, options);
      }
    };
  }

  /** Single-page-app navigation: forget everything about the previous document. */
  reset(): void {
    this.firstSeen.clear();
    this.initialChecked = new WeakMap();
    this.labelFirstRevision.clear();
    this.amountFirstRevision.clear();
  }

  read(revision: number): ReadResult {
    const state: WalkState = {
      revision,
      fields: [],
      choices: [],
      buttons: [],
      prices: [],
      priceMeta: new Map(),
      priceElements: new Set(),
      links: [],
      buttonElements: new Map(),
      sections: [],
      current: null,
      headingText: null,
      inHeading: 0,
      inInteractive: 0,
      inChoiceLabel: 0,
      clocks: [],
      truncated: false,
    };
    const body = this.doc.body as HTMLElement | null;
    if (body) this.visitChildren(body, state);
    this.closeSection(state);

    const sections = this.finishSections(state);
    const snapshot: Snapshot = {
      contract_version: 1,
      url: this.doc.location.href.split('#')[0] ?? '',
      title: clip(normaliseWs(this.doc.title), 300),
      lang: this.doc.documentElement.lang || null,
      page_type_hint: 'other',
      revision,
      captured_at: new Date().toISOString(),
      truncated: state.truncated,
      fields: state.fields,
      checkboxes: state.choices,
      buttons: state.buttons,
      prices: state.prices,
      sections: sections.list,
      legal_links: state.links,
      cookie_banner: this.cookieBanner(state),
      client_flags: [],
    };
    this.fitSize(snapshot);
    return {
      snapshot,
      prices: state.priceMeta,
      sections: sections.bounds,
      clockCandidates: state.clocks,
    };
  }

  // --- The walk ---

  private skips(el: Element): boolean {
    if (SKIP_SUBTREE.has(el.tagName.toUpperCase())) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    const parent = el.parentElement;
    if (parent instanceof HTMLDetailsElement && !parent.open && el.tagName !== 'SUMMARY') {
      return true;
    }
    // Styled checkboxes often hide the input itself; addChoice checks its label too.
    if (isChoiceInput(el)) return false;
    return !this.layout.displayed(el);
  }

  private visitChildren(node: Node, state: WalkState): void {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) this.onText(child as Text, state);
      else if (child instanceof Element && !this.skips(child)) this.onElement(child, state);
    }
  }

  private onElement(el: Element, state: WalkState): void {
    const tag = el.tagName.toUpperCase();
    const level = HEADINGS[tag];
    if (level !== undefined) {
      this.openHeadedSection(el, level, state);
      state.inHeading += 1;
      this.visitChildren(el, state);
      state.inHeading -= 1;
      return;
    }
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox' || el.type === 'radio') this.addChoice(el, state);
      else if (['submit', 'button', 'image', 'reset'].includes(el.type)) this.addButton(el, state);
      else if (!NON_FIELD_INPUTS.has(el.type)) this.addField(el, state);
      return;
    }
    if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      this.addField(el, state);
      return;
    }
    if ((el as HTMLElement).isContentEditable) return;
    if (tag === 'BR') {
      this.appendText(' ', state);
      return;
    }

    const block = isBlockDisplay(this.layout.style(el).display);
    if (block) this.onBlockBoundary(state);

    const interactive = el instanceof HTMLButtonElement || el.getAttribute('role') === 'button';
    const link = el instanceof HTMLAnchorElement && el.hasAttribute('href');
    if (interactive) this.addButton(el, state);
    else if (link) this.addLink(el, state);
    const choiceLabel = el instanceof HTMLLabelElement && isChoiceInput(el.control);

    if (interactive || link) state.inInteractive += 1;
    if (choiceLabel) state.inChoiceLabel += 1;
    this.visitChildren(el, state);
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) this.visitChildren(shadow, state);
    if (interactive || link) state.inInteractive -= 1;
    if (choiceLabel) state.inChoiceLabel -= 1;

    if (block) this.appendText(' ', state);
  }

  private onText(node: Text, state: WalkState): void {
    const raw = node.data;
    if (state.inHeading > 0) return;
    if (!raw.trim()) {
      if (state.current) this.appendText(' ', state);
      return;
    }
    const parent = node.parentElement;
    if (!parent) return;
    if (!state.current) this.openUnheadedSection(this.nearestBlock(parent) ?? parent, state);
    this.appendText(raw, state);

    if (
      state.inInteractive === 0 &&
      state.inChoiceLabel === 0 &&
      !state.priceElements.has(parent)
    ) {
      const amount = findAmounts(raw)[0];
      if (amount) this.addPrice(parent, amount, state);
    }
    const trimmed = raw.trim();
    if (trimmed.length <= 60 && CLOCK_RE.test(trimmed)) state.clocks.push(parent);
  }

  // --- Sections ---

  private appendText(text: string, state: WalkState): void {
    const current = state.current;
    if (!current) return;
    current.parts.push(text);
    current.length += text.length;
  }

  private onBlockBoundary(state: WalkState): void {
    const current = state.current;
    if (current && current.heading === null && current.length >= UNHEADED_CHARS) {
      this.closeSection(state);
    }
  }

  private openHeadedSection(el: Element, level: number, state: WalkState): void {
    this.closeSection(state);
    const heading = clip(textOf(el), 200) || null;
    state.headingText = heading;
    state.current = {
      anchor: el,
      id: this.registry.idFor(el, 's'),
      heading,
      level,
      parts: [],
      length: 0,
    };
  }

  private openUnheadedSection(anchor: Element, state: WalkState): void {
    state.current = {
      anchor,
      id: this.registry.idFor(anchor, 's'),
      heading: null,
      level: null,
      parts: [],
      length: 0,
    };
  }

  private closeSection(state: WalkState): void {
    const current = state.current;
    state.current = null;
    if (!current) return;
    state.sections.push({
      anchor: current.anchor,
      id: current.id,
      heading: current.heading,
      level: current.level,
      text: normaliseWs(current.parts.join('')),
    });
  }

  /** Splits long sections, drops empty ones, applies the limit and records the bounds. */
  private finishSections(state: WalkState): {
    list: SnapshotSection[];
    bounds: Map<string, SectionBounds>;
  } {
    const list: SnapshotSection[] = [];
    const bounds = new Map<string, SectionBounds>();
    const all = state.sections;
    all.forEach((section, index) => {
      const end = all[index + 1]?.anchor ?? null;
      bounds.set(section.id, { anchor: section.anchor, end });
      if (!section.text) return;
      splitText(section.text, LIMITS.sectionChars).forEach((text, part) => {
        const id =
          part === 0 ? section.id : this.registry.partId(section.id, part + 1, section.anchor);
        if (part > 0) bounds.set(id, { anchor: section.anchor, end });
        const heading =
          part === 0 || section.heading === null ? section.heading : `${section.heading} (cont.)`;
        list.push({ id, heading, level: section.level, text });
      });
    });
    if (list.length > LIMITS.sections) {
      state.truncated = true;
      list.length = LIMITS.sections;
    }
    return { list, bounds };
  }

  // --- Items ---

  private firstSeenRevision(id: string, revision: number): number {
    const seen = this.firstSeen.get(id);
    if (seen !== undefined) return seen;
    this.firstSeen.set(id, revision);
    return revision;
  }

  private addField(el: FormControl, state: WalkState): void {
    if (!isRendered(this.layout, el)) return;
    if (state.fields.length >= LIMITS.fields) {
      state.truncated = true;
      return;
    }
    const explicit = labelFor(el);
    let sensitive = isSensitive(el, explicit);
    const label = explicit || fallbackLabel(el, !sensitive);
    if (!explicit) sensitive = isSensitive(el, label);
    const placeholder = normaliseWs(el.getAttribute('placeholder') ?? '');
    const id = this.registry.idFor(el, 'i');
    this.firstSeenRevision(id, state.revision);
    state.fields.push({
      id,
      label,
      type:
        el instanceof HTMLSelectElement
          ? 'select'
          : el instanceof HTMLTextAreaElement
            ? 'textarea'
            : (FIELD_TYPES[el.type.toLowerCase()] ?? 'other'),
      required: el.required || el.getAttribute('aria-required') === 'true',
      placeholder: sensitive || !placeholder ? null : clip(placeholder, 200),
      help_text: helpTextFor(el, this.layout),
      section: legendOf(el) ?? state.headingText,
      options:
        el instanceof HTMLSelectElement
          ? Array.from(el.options)
              .map((option) => clip(normaliseWs(option.label || option.text), 100))
              .filter(Boolean)
              .slice(0, 20)
          : [],
      filled: isFilled(el),
      sensitive,
    });
  }

  private addChoice(el: HTMLInputElement, state: WalkState): void {
    const labels = Array.from(el.labels ?? []);
    const visible =
      isRendered(this.layout, el) || labels.some((label) => isRendered(this.layout, label));
    if (!visible) return;
    if (state.choices.length >= LIMITS.choices) {
      state.truncated = true;
      return;
    }
    if (!this.initialChecked.has(el)) this.initialChecked.set(el, el.checked);
    const label = labelFor(el) || fallbackLabel(el, false);
    const legend = legendOf(el);
    const id = this.registry.idFor(el, 'i');
    state.choices.push({
      id,
      label,
      kind: el.type === 'radio' ? 'radio' : 'checkbox',
      group: legend ?? (el.type === 'radio' && el.name ? el.name : null),
      checked: el.checked,
      prechecked: this.initialChecked.get(el) === true && !this.interacted.has(el),
      amount_inr: parseInr(label),
      first_seen_revision: this.firstSeenRevision(id, state.revision),
    });
  }

  private buttonText(el: Element): string {
    const text =
      el instanceof HTMLInputElement
        ? normaliseWs(el.type === 'image' ? el.alt : el.value)
        : textOf(el);
    return clip(text || normaliseWs(el.getAttribute('aria-label') ?? ''), 120);
  }

  private addButton(el: Element, state: WalkState): void {
    if (!isRendered(this.layout, el)) return;
    const text = this.buttonText(el);
    if (!text) return;
    if (state.buttons.length >= LIMITS.buttons) {
      state.truncated = true;
      return;
    }
    const id = this.registry.idFor(el, 'i');
    const submit =
      (el instanceof HTMLButtonElement && el.type === 'submit' && el.form !== null) ||
      (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'image'));
    const disabled =
      ((el instanceof HTMLButtonElement || el instanceof HTMLInputElement) && el.disabled) ||
      el.getAttribute('aria-disabled') === 'true';
    state.buttons.push({ id, text, kind: submit ? 'submit' : 'button', disabled });
    state.buttonElements.set(id, el);
  }

  /** Links styled as buttons count as buttons; legal links are listed too. */
  private addLink(el: HTMLAnchorElement, state: WalkState): void {
    if (!isRendered(this.layout, el)) return;
    const text = this.buttonText(el);
    if (!text) return;
    if (LEGAL_RE.test(text)) {
      if (state.links.length < LIMITS.legalLinks) {
        state.links.push({ id: this.registry.idFor(el, 'i'), text, href: el.href });
      } else state.truncated = true;
    }
    if (!this.looksLikeButton(el)) return;
    if (state.buttons.length >= LIMITS.buttons) {
      state.truncated = true;
      return;
    }
    const id = this.registry.idFor(el, 'i');
    state.buttons.push({
      id,
      text,
      kind: 'link',
      disabled: el.getAttribute('aria-disabled') === 'true',
    });
    state.buttonElements.set(id, el);
  }

  private looksLikeButton(el: Element): boolean {
    const style = this.layout.style(el);
    if (style.display === 'inline') return false;
    const background = style.backgroundColor;
    const filled =
      background !== '' && background !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(background);
    const bordered = Number.parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none';
    return filled || bordered;
  }

  // --- Prices ---

  private nearestBlock(el: Element | null): Element | null {
    for (let node = el; node && node !== this.doc.body; node = node.parentElement) {
      if (isBlockDisplay(this.layout.style(node).display)) return node;
    }
    return null;
  }

  /** The row's label, or undefined when the amount sits in running prose. */
  private priceLabel(el: Element, amount: AmountMatch): string | null | undefined {
    const cell = el.closest('td, th, dd');
    if (cell) {
      const cellText = textOf(cell);
      if (cellText.length > PRICE_ROW_CHARS) return undefined;
      if (cell.tagName === 'DD') {
        let dt = cell.previousElementSibling;
        while (dt && dt.tagName !== 'DT') dt = dt.previousElementSibling;
        return dt ? clip(textOf(dt), 200) || null : null;
      }
      const row = cell.parentElement;
      const header = Array.from(row?.children ?? []).find(
        (other) => other !== cell && textOf(other) && !findAmounts(textOf(other)).length,
      );
      return header ? clip(textOf(header), 200) : null;
    }
    let block = this.nearestBlock(el);
    if (!block || textOf(block).length > PRICE_ROW_CHARS) return undefined;
    for (let depth = 0; block && depth < 3; depth += 1) {
      const text = textOf(block);
      if (text.length > PRICE_ROW_CHARS) break;
      const label = cleanLabel(text, amount.text);
      if (label) return clip(label, 200);
      block = this.nearestBlock(block.parentElement);
    }
    return null;
  }

  private addPrice(el: Element, amount: AmountMatch, state: WalkState): void {
    const label = this.priceLabel(el, amount);
    if (label === undefined) return;
    if (state.prices.length >= LIMITS.prices) {
      state.truncated = true;
      return;
    }
    state.priceElements.add(el);
    const id = this.registry.idFor(el, 'i');
    const firstSeen = this.firstSeenRevision(id, state.revision);
    const labelKey = (label ?? '').toLowerCase();
    if (!this.labelFirstRevision.has(labelKey))
      this.labelFirstRevision.set(labelKey, state.revision);
    if (!this.amountFirstRevision.has(amount.inr)) {
      this.amountFirstRevision.set(amount.inr, state.revision);
    }
    state.prices.push({
      id,
      label,
      amount_text: amount.text,
      amount_inr: amount.inr,
      first_seen_revision: firstSeen,
    });
    const row = this.nearestBlock(el);
    state.priceMeta.set(id, {
      period: amount.period,
      sectionId: state.current?.id ?? null,
      rowText: row ? textOf(row) : textOf(el),
      labelFirstRevision: this.labelFirstRevision.get(labelKey) ?? state.revision,
      amountFirstRevision: this.amountFirstRevision.get(amount.inr) ?? state.revision,
    });
  }

  // --- Cookie banner ---

  private isFixed(el: Element): boolean {
    const position = this.layout.style(el).position;
    return position === 'fixed' || position === 'sticky';
  }

  private cookieBanner(state: WalkState): Snapshot['cookie_banner'] {
    for (const button of state.buttons) {
      if (!ACCEPT_RE.test(button.text)) continue;
      const el = state.buttonElements.get(button.id);
      let banner: Element | null = el?.parentElement ?? null;
      while (banner && banner !== this.doc.body) {
        if (this.isFixed(banner) && /cookie/i.test(textOf(banner))) break;
        banner = banner.parentElement;
      }
      if (!banner || banner === this.doc.body) continue;
      const inside = state.buttons.filter((other) => {
        const otherEl = state.buttonElements.get(other.id);
        return otherEl !== undefined && banner.contains(otherEl);
      });
      const reject = inside.find((other) => REJECT_RE.test(other.text));
      const manage = inside.find((other) => MANAGE_RE.test(other.text));
      return {
        id: this.registry.idFor(banner, 'i'),
        accept_button_id: button.id,
        reject_button_id: reject?.id ?? null,
        manage_button_id: manage?.id ?? null,
        reject_visible: reject !== undefined,
      };
    }
    return null;
  }

  /** The whole snapshot stays under 400 KB: drop sections from the end until it fits. */
  private fitSize(snapshot: Snapshot): void {
    const encoder = new TextEncoder();
    while (
      snapshot.sections.length > 0 &&
      encoder.encode(JSON.stringify(snapshot)).length > LIMITS.snapshotBytes
    ) {
      snapshot.sections.pop();
      snapshot.truncated = true;
    }
  }
}

/** "QuickCred Shield ₹1,299/year" minus the amount → "QuickCred Shield". */
export function cleanLabel(rowText: string, amountText: string): string {
  let text = rowText;
  if (text.length > 80) {
    const sentence = text.split(/(?<=[.!?])\s+/).find((part) => part.includes(amountText));
    if (sentence) text = sentence;
  }
  return normaliseWs(text.replace(amountText, ' '))
    .replace(/^[\s:–—\-*·|,]+|[\s:–—\-*·|,]+$/g, '')
    .trim();
}
