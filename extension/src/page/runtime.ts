/**
 * Everything Iris runs inside a web page, in one place: the reader, client checks, watcher
 * and overlay. The content script and the widget's in-page adapter both wrap this. Nothing
 * here talks to the network, and nothing is added to the page but the overlay host.
 */
import type {
  ChipRequest,
  ElementDescription,
  HighlightRequest,
  HighlightResult,
  PageEvent,
} from '../adapters/page-adapter';
import type { PointerHint } from '../core/api';
import { HesitationDetector } from './hesitation';
import { clip, textOf } from './labels';
import { browserLayout, type Layout, type Rect } from './layout';
import { Overlay, type DrawTarget, type OverlayRect } from './overlay/overlay';
import { findQuoteRange, sectionRange } from './overlay/text-range';
import { pageTypeHint } from './page-type';
import { PointerTracker } from './pointer';
import { PRICE_ROW_CHARS, Reader, type ReadResult, type Snapshot } from './reader';
import { Registry } from './registry';
import { clientFlags, CountdownDetector } from './rules';
import { Watcher } from './watcher';

/** Legal links this close to a submit button count as "terms near submit". */
const LEGAL_NEAR_SUBMIT_PX = 300;

export interface PageRuntimeOptions {
  doc?: Document;
  layout?: Layout;
  /** Areas the widget covers, kept clear when scrolling to a highlight. */
  avoid?: () => Rect[];
  onEscape?: () => void;
  sleep?: (ms: number) => Promise<void>;
  debounceMs?: number;
}

interface Capture {
  read: ReadResult;
  snapshot: Snapshot;
}

function idsOf(snapshot: Snapshot): string {
  return [
    ...snapshot.fields.map((f) => f.id),
    ...snapshot.checkboxes.map((c) => c.id),
    ...snapshot.prices.map((p) => p.id),
  ].join(',');
}

function flagsOf(snapshot: Snapshot): string {
  return snapshot.client_flags.map((f) => `${f.rule}:${f.element_ids.join('+')}`).join(',');
}

/** Roughly how many characters differ: everything between the common start and end. */
export function changedChars(a: string, b: string): number {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end += 1;
  }
  return Math.max(a.length, b.length) - start - end;
}

/** New sections smaller than this (a sticky header appearing on scroll) don't count. */
const SECTIONS_ADDED_CHARS = 200;

/**
 * Controls or prices added or removed, sections added, >20% of text changed.
 * Every re-snapshot is a new page_id and, if the text changed, a new scan, so page chrome
 * that appears on scroll isn't treated as new content.
 */
export function isMeaningfulChange(prev: Snapshot, next: Snapshot): boolean {
  if (idsOf(prev) !== idsOf(next) || flagsOf(prev) !== flagsOf(next)) return true;
  const prevSections = new Map(prev.sections.map((s) => [s.id, s.text]));
  const added = next.sections
    .filter((s) => !prevSections.has(s.id))
    .reduce((sum, s) => sum + s.text.length, 0);
  if (added >= SECTIONS_ADDED_CHARS) return true;
  const total = Math.max(
    prev.sections.reduce((sum, s) => sum + s.text.length, 0),
    next.sections.reduce((sum, s) => sum + s.text.length, 0),
    1,
  );
  const nextIds = new Set(next.sections.map((s) => s.id));
  const changed =
    next.sections.reduce((sum, s) => sum + changedChars(prevSections.get(s.id) ?? '', s.text), 0) +
    prev.sections.filter((s) => !nextIds.has(s.id)).reduce((sum, s) => sum + s.text.length, 0);
  return changed / total > 0.2;
}

export class PageRuntime {
  private readonly doc: Document;
  private readonly layout: Layout;
  private readonly registry = new Registry();
  private readonly reader: Reader;
  private readonly countdown: CountdownDetector;
  private readonly watcher: Watcher;
  private readonly overlay: Overlay;
  private readonly hesitation: HesitationDetector;
  private readonly pointer: PointerTracker;
  /** One-off events already sent for this document. */
  private sentOnce = new Set<string>();
  private readonly listeners = new Set<(event: PageEvent) => void>();
  private revision = 0;
  private last: Capture | null = null;
  /** Captures run one at a time (the countdown check waits a second). */
  private queue: Promise<unknown> = Promise.resolve();
  private stopTracking: (() => void) | null = null;
  private started = false;

  constructor(options: PageRuntimeOptions = {}) {
    this.doc = options.doc ?? document;
    this.layout = options.layout ?? browserLayout;
    this.reader = new Reader(this.registry, this.layout, this.doc);
    this.countdown = new CountdownDetector(options.sleep);
    this.overlay = new Overlay({
      doc: this.doc,
      layout: this.layout,
      avoid: options.avoid,
      onEscape: options.onEscape,
      onChipHidden: () => {
        this.emit({ type: 'chip-hidden' });
      },
    });
    this.hesitation = new HesitationDetector({
      doc: this.doc,
      fieldId: (el) => {
        const id = this.registry.peek(el);
        return id && this.last?.snapshot.fields.some((f) => f.id === id) ? id : null;
      },
      onHesitation: (elementId) => {
        this.emit({ type: 'hesitation', element_id: elementId });
      },
      onFieldActivity: (el) => {
        if (this.overlay.chipElement === el) this.overlay.hideChips();
      },
    });
    this.pointer = new PointerTracker({
      doc: this.doc,
      layout: this.layout,
      elementAt: (x, y) => this.doc.elementFromPoint(x, y),
      onFocus: (el) => {
        const id = this.registry.peek(el);
        const snapshot = this.last?.snapshot;
        const known =
          snapshot?.fields.some((f) => f.id === id) ||
          snapshot?.checkboxes.some((c) => c.id === id);
        if (id && known) this.emit({ type: 'control-focus', element_id: id });
      },
      onDwell: (hint) => {
        const elementId = hint.price_id ?? hint.section_id;
        if (!elementId) return;
        this.emit({
          type: 'dwell',
          element_id: elementId,
          section_id: hint.section_id ?? null,
          price_id: hint.price_id ?? null,
        });
      },
      targets: {
        field: (el) => this.fieldAt(el),
        price: (el) => this.priceAt(el),
        section: (el) => this.sectionAt(el),
        fields: () =>
          (this.last?.snapshot.fields ?? []).flatMap((field) => {
            const element = this.registry.elementFor(field.id);
            return element ? [{ id: field.id, element }] : [];
          }),
      },
    });
    this.watcher = new Watcher({
      doc: this.doc,
      debounceMs: options.debounceMs,
      onChange: () => void this.check(),
      onNavigate: () => void this.navigated(),
    });
  }

  /**
   * Starts watching. The first snapshot is taken locally once the page is idle, so later
   * revisions (a fee that appears after "Continue") are measured against it.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopTracking = this.reader.trackInteraction();
    this.watcher.start();
    this.hesitation.start();
    this.pointer.start();
    const win = this.doc.defaultView;
    const first = () => void this.check();
    if (win && 'requestIdleCallback' in win) win.requestIdleCallback(first, { timeout: 1_500 });
    else setTimeout(first, 200);
  }

  destroy(): void {
    this.watcher.stop();
    this.hesitation.stop();
    this.pointer.stop();
    this.overlay.destroy();
    this.stopTracking?.();
    this.listeners.clear();
  }

  onPageEvent(callback: (event: PageEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** The latest snapshot, after any pending change has been checked. */
  async getSnapshot(): Promise<Snapshot> {
    this.watcher.flush();
    await this.check();
    if (!this.last) throw new Error('No snapshot');
    return this.last.snapshot;
  }

  lastSnapshot(): Snapshot | null {
    return this.last?.snapshot ?? null;
  }

  /** Counts of high and medium client flags (the extension's toolbar badge). */
  flagCounts(): { high: number; medium: number } {
    const flags = this.last?.snapshot.client_flags ?? [];
    return {
      high: flags.filter((f) => f.severity === 'high').length,
      medium: flags.filter((f) => f.severity === 'medium').length,
    };
  }

  elementFor(id: string): Element | null {
    return this.registry.elementFor(id);
  }

  highlight(request: HighlightRequest): HighlightResult {
    const found: string[] = [];
    const missing: string[] = [];
    const targets: DrawTarget[] = [];
    let quoteUsed = false;
    for (const id of request.ids) {
      const element = this.registry.elementFor(id);
      if (!element) {
        missing.push(id);
        continue;
      }
      found.push(id);
      if (!id.startsWith('s-')) {
        targets.push({ kind: 'element', id, element });
        continue;
      }
      targets.push({
        kind: 'text',
        id,
        range: this.textRange(id, element, quoteUsed ? null : request.quote_text),
        anchor: element,
      });
      quoteUsed = true;
    }
    const bubble =
      request.note || request.title || request.risk
        ? { title: request.title ?? null, text: request.note ?? null, risk: request.risk ?? null }
        : null;
    const focusId = request.ids[request.focus ?? 0];
    const focus = Math.max(
      0,
      targets.findIndex((target) => target.id === focusId),
    );
    void this.overlay.show({ targets, level: request.level, bubble, focus });
    return { found, missing };
  }

  clearHighlights(): void {
    this.overlay.clear();
  }

  showChip(request: ChipRequest): void {
    const element = this.registry.elementFor(request.element_id);
    if (!element) return;
    this.overlay.showChip({
      element,
      label: request.label,
      onActivate: () => {
        this.overlay.hideChips();
        this.emit({ type: 'chip-clicked', kind: request.kind, element_id: request.element_id });
      },
    });
  }

  hideChips(): void {
    this.overlay.hideChips();
  }

  get chipElement(): Element | null {
    return this.overlay.chipElement;
  }

  describeElement(id: string): ElementDescription | null {
    const element = this.registry.elementFor(id);
    if (!element) return null;
    const rect = this.layout.rect(element);
    return {
      tag: element.tagName.toLowerCase(),
      text: clip(textOf(element), 200),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }

  overlayRects(): OverlayRect[] {
    return this.overlay.rects();
  }

  /** What the user last pointed at, without IDs whose element has left the page. */
  pointerHint(): PointerHint | null {
    const hint = this.pointer.current();
    if (!hint) return null;
    const live = (id: string | null | undefined) =>
      id && this.registry.elementFor(id) ? id : null;
    const kept = {
      field_id: live(hint.field_id),
      price_id: live(hint.price_id),
      section_id: live(hint.section_id),
    };
    return kept.field_id || kept.price_id || kept.section_id ? kept : null;
  }

  // --- Internals ---

  /** A form field Iris has read: the control itself, or its label. */
  private fieldAt(el: Element): string | null {
    const control = el.closest('label')?.control ?? el;
    const id = this.registry.peek(control);
    return id && this.last?.snapshot.fields.some((f) => f.id === id) ? id : null;
  }

  /** A price, when the element is in its row (a short block holding only that price). */
  private priceAt(el: Element): string | null {
    const prices = (this.last?.snapshot.prices ?? []).flatMap((price) => {
      const element = this.registry.elementFor(price.id);
      return element ? [{ id: price.id, element }] : [];
    });
    let node: Element | null = el;
    for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      const block = node;
      const inside = prices.filter((price) => block.contains(price.element));
      if (inside.length > 1 || textOf(block).length > PRICE_ROW_CHARS) return null;
      if (inside.length === 1) return inside[0]?.id ?? null;
    }
    return null;
  }

  /** The section whose text contains the element (between its anchor and the next one). */
  private sectionAt(el: Element): string | null {
    const read = this.last?.read;
    if (!read) return null;
    const listed = new Set(read.snapshot.sections.map((section) => section.id));
    for (const [id, bounds] of read.sections) {
      if (!listed.has(id)) continue;
      const started =
        bounds.anchor === el ||
        Boolean(bounds.anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      const ended =
        bounds.end !== null &&
        (el.contains(bounds.end) ||
          !(bounds.end.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING));
      if (started && !ended) return id;
    }
    return null;
  }

  private emit(event: PageEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** The quote inside a section; its heading if the quote isn't there; else the whole section. */
  private textRange(id: string, element: Element, quote: string | null | undefined): Range {
    const bounds = this.last?.read.sections.get(id);
    if (bounds && quote) {
      const range = findQuoteRange(bounds, quote);
      if (range) return range;
    }
    if (bounds && !quote) return sectionRange(bounds);
    const range = this.doc.createRange();
    range.selectNodeContents(element);
    return range;
  }

  private async capture(revision: number): Promise<Capture> {
    const read = this.reader.read(revision);
    const running = await this.countdown.running(read.clockCandidates);
    const snapshot = read.snapshot;
    snapshot.page_type_hint = pageTypeHint(snapshot);
    snapshot.client_flags = clientFlags({
      snapshot,
      prices: read.prices,
      countdownIds: running.map((el) => this.registry.idFor(el, 'i')),
    });
    return { read, snapshot };
  }

  private check(navigation = false): Promise<void> {
    const run = async () => {
      const next = await this.capture(this.revision + 1);
      const previous = this.last;
      if (previous && !isMeaningfulChange(previous.snapshot, next.snapshot)) {
        next.snapshot.revision = this.revision;
        this.last = {
          read: next.read,
          snapshot: { ...next.snapshot, captured_at: previous.snapshot.captured_at },
        };
        return;
      }
      this.revision += 1;
      this.last = next;
      this.emit({
        type: 'page-changed',
        revision: this.revision,
        captured_at: next.snapshot.captured_at,
        navigation,
      });
      this.pageEventsOnce(next.snapshot);
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async navigated(): Promise<void> {
    await this.queue;
    this.overlay.clear();
    this.overlay.hideChips();
    this.registry.reset();
    this.reader.reset();
    this.pointer.reset();
    this.countdown.reset();
    this.revision = 0;
    this.last = null;
    this.sentOnce.clear();
    await this.check(true);
  }

  /** A hidden cookie reject option, and legal links next to a submit button: once each. */
  private pageEventsOnce(snapshot: Snapshot): void {
    const banner = snapshot.cookie_banner;
    if (banner?.accept_button_id && !banner.reject_visible && !this.sentOnce.has('cookie')) {
      this.sentOnce.add('cookie');
      this.emit({ type: 'cookie_banner', element_id: banner.accept_button_id });
    }
    if (this.sentOnce.has('legal')) return;
    const submits = snapshot.buttons
      .filter((b) => b.kind === 'submit')
      .map((b) => this.registry.elementFor(b.id))
      .filter((el): el is Element => el !== null);
    for (const link of snapshot.legal_links) {
      const el = this.registry.elementFor(link.id);
      if (!el) continue;
      const a = this.layout.rect(el);
      const near = submits.some((submit) => {
        const b = this.layout.rect(submit);
        const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
        const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
        return Math.hypot(dx, dy) <= LEGAL_NEAR_SUBMIT_PX;
      });
      if (near) {
        this.sentOnce.add('legal');
        this.emit({ type: 'legal_links_near_submit', element_id: link.id });
        return;
      }
    }
  }
}
