/**
 * What the user means by "this": what the mouse last rested on for half a second,
 * or the form field they last clicked or tabbed into, whichever came last. Listening only:
 * nothing on the page changes, no field value is read, and only element IDs are kept.
 */
import type { PointerHint } from '../core/api';
import { IRIS_HOSTS } from './labels';
import type { Layout, Rect } from './layout';

export const REST_MS = 500;
/** A longer rest on a clause or price offers "Explain" there. */
export const DWELL_MS = 2_000;
/** A field this close to where the mouse rests counts as the one it points at. */
export const NEAREST_FIELD_PX = 100;
/** A hand on the mouse jitters: smaller moves don't restart the rest timer. */
const JITTER_PX = 4;

/** Element → ID lookups for things Iris has read (the runtime supplies them). */
export interface PointerTargets {
  field(el: Element): string | null;
  price(el: Element): string | null;
  section(el: Element): string | null;
  fields(): { id: string; element: Element }[];
}

export function distanceTo(x: number, y: number, rect: Rect): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

export function nearestField(
  targets: PointerTargets,
  layout: Layout,
  x: number,
  y: number,
): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const { id, element } of targets.fields()) {
    const distance = distanceTo(x, y, layout.rect(element));
    if (distance <= NEAREST_FIELD_PX && (!best || distance < best.distance))
      best = { id, distance };
  }
  return best?.id ?? null;
}

/** The field, price and section at a point, or null when the mouse rests on none of them. */
export function hintAt(
  el: Element,
  x: number,
  y: number,
  targets: PointerTargets,
  layout: Layout,
): PointerHint | null {
  const hint = {
    field_id: targets.field(el) ?? nearestField(targets, layout, x, y),
    price_id: targets.price(el),
    section_id: targets.section(el),
  };
  return hint.field_id || hint.price_id || hint.section_id ? hint : null;
}

function isIris(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (IRIS_HOSTS.has(node.tagName.toUpperCase())) return true;
  }
  return false;
}

export interface PointerTrackerOptions {
  doc?: Document;
  layout: Layout;
  targets: PointerTargets;
  /** What's under a point now (content moves under a resting mouse when the page scrolls). */
  elementAt?: (x: number, y: number) => Element | null;
  restMs?: number;
  dwellMs?: number;
  /** The mouse has rested on a clause or a price (not a field) for DWELL_MS. */
  onDwell?: (hint: PointerHint) => void;
  /** Something on the page (not Iris) got focus: the runtime says if it's a form control. */
  onFocus?: (el: Element) => void;
}

interface Point {
  x: number;
  y: number;
  target: Element;
}

export class PointerTracker {
  private readonly doc: Document;
  private hint: PointerHint | null = null;
  private point: Point | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dwellTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: PointerTrackerOptions) {
    this.doc = options.doc ?? document;
  }

  start(): void {
    const passive = { capture: true, passive: true };
    this.doc.addEventListener('mousemove', this.onMove, passive);
    this.doc.addEventListener('pointerdown', this.onDown, passive);
    this.doc.addEventListener('focusin', this.onFocus, true);
    this.doc.addEventListener('scroll', this.onScroll, passive);
    this.doc.addEventListener('mouseout', this.onOut, passive);
  }

  stop(): void {
    clearTimeout(this.timer);
    clearTimeout(this.dwellTimer);
    this.doc.removeEventListener('mousemove', this.onMove, true);
    this.doc.removeEventListener('pointerdown', this.onDown, true);
    this.doc.removeEventListener('focusin', this.onFocus, true);
    this.doc.removeEventListener('scroll', this.onScroll, true);
    this.doc.removeEventListener('mouseout', this.onOut, true);
  }

  /** Single-page-app navigation: element IDs start again, so forget the old one. */
  reset(): void {
    clearTimeout(this.timer);
    clearTimeout(this.dwellTimer);
    this.hint = null;
    this.point = null;
  }

  current(): PointerHint | null {
    return this.hint;
  }

  private readonly onMove = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const previous = this.point;
    this.point = { x: event.clientX, y: event.clientY, target: event.target };
    if (
      !previous ||
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > JITTER_PX
    ) {
      this.arm();
    }
  };

  /** A click points at once. */
  private readonly onDown = (event: PointerEvent) => {
    if (!(event.target instanceof Element)) return;
    this.point = { x: event.clientX, y: event.clientY, target: event.target };
    this.rest();
  };

  private readonly onFocus = (event: FocusEvent) => {
    const el = event.target;
    if (!(el instanceof Element) || isIris(el)) return;
    this.options.onFocus?.(el);
    const field = this.options.targets.field(el);
    if (field) {
      this.hint = { field_id: field, price_id: null, section_id: this.options.targets.section(el) };
    }
  };

  private readonly onScroll = () => {
    if (this.point) this.arm();
  };

  /** The mouse left the page (to the side panel, say): what it last rested on still counts. */
  private readonly onOut = (event: MouseEvent) => {
    if (event.relatedTarget !== null) return;
    clearTimeout(this.timer);
    clearTimeout(this.dwellTimer);
    this.point = null;
  };

  private arm(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.rest();
    }, this.options.restMs ?? REST_MS);
    clearTimeout(this.dwellTimer);
    if (!this.options.onDwell) return;
    this.dwellTimer = setTimeout(() => {
      this.dwell();
    }, this.options.dwellMs ?? DWELL_MS);
  }

  /** Only clauses and prices: a field under the mouse has its own "Explain" chip. */
  private dwell(): void {
    const point = this.point;
    if (!point) return;
    const el = this.options.elementAt?.(point.x, point.y) ?? point.target;
    if (!el.isConnected || isIris(el) || this.options.targets.field(el)) return;
    const hint = hintAt(el, point.x, point.y, this.options.targets, this.options.layout);
    if (hint && (hint.price_id || hint.section_id)) this.options.onDwell?.(hint);
  }

  private rest(): void {
    clearTimeout(this.timer);
    const point = this.point;
    if (!point) return;
    const el = this.options.elementAt?.(point.x, point.y) ?? point.target;
    if (!el.isConnected || isIris(el)) return;
    const hint = hintAt(el, point.x, point.y, this.options.targets, this.options.layout);
    if (hint) this.hint = hint;
  }
}
