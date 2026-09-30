/**
 * The on-page overlay: one <iris-overlay> host with an open
 * Shadow DOM, drawn over the page. It never touches the page's own elements; only the
 * bubble and the chip accept clicks. One render loop re-measures on scroll and resize.
 */
import { arrow, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom';
import { render } from 'preact';
import { browserLayout, type Layout, type Rect } from '../layout';
import { badgeRect } from './badges';
import { Bubble, type BubbleContent } from './bubble';
import { Chip } from './chip';
import { lineRects, onDarkBackground } from './marker';
import { grow, ringRadius, RING_GAP, targetRect, union } from './rings';
import { scrollToFree } from './scroll';
import { OVERLAY_CSS } from './styles';

export type OverlayKind = 'ring' | 'risk_ring' | 'marker' | 'bubble' | 'chip' | 'badge';

export interface OverlayRect {
  kind: OverlayKind;
  rect: Rect;
}

/** One highlighted item: an element (ring) or page text (marker). */
export type DrawTarget =
  | { kind: 'element'; id: string; element: Element }
  | { kind: 'text'; id: string; range: Range; anchor: Element };

export interface ShowRequest {
  targets: DrawTarget[];
  level: 'normal' | 'risk';
  bubble: BubbleContent | null;
  /** The item to scroll to and put the bubble on ("Show on page" steps through them). */
  focus?: number;
}

export interface ChipRequest {
  element: Element;
  label: string;
  onActivate: () => void;
}

export interface OverlayOptions {
  doc?: Document;
  layout?: Layout;
  /** Areas Iris itself covers (the widget), kept clear when scrolling. */
  avoid?: () => Rect[];
  /** Esc was pressed with something on screen. */
  onEscape?: () => void;
  onChipHidden?: () => void;
  highlightMs?: number;
  chipMs?: number;
}

interface Shown {
  request: ShowRequest;
  boxes: HTMLDivElement[];
  bubble: HTMLDivElement | null;
  /** The Preact root inside the bubble (the pointer sits next to it). */
  content: HTMLDivElement | null;
  arrow: HTMLDivElement | null;
  visible: boolean;
  dark: boolean;
}

interface ShownChip {
  request: ChipRequest;
  wrap: HTMLDivElement;
}

const HIGHLIGHT_MS = 20_000;
const CHIP_MS = 15_000;

function virtualElement(rect: Rect, context: Element) {
  return {
    getBoundingClientRect: () => DOMRect.fromRect(rect),
    contextElement: context,
  };
}

export class Overlay {
  private readonly doc: Document;
  private readonly layout: Layout;
  private host: HTMLElement | null = null;
  private layer: HTMLDivElement | null = null;
  private shown: Shown | null = null;
  private chip: ShownChip | null = null;
  private frame = 0;
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;
  private chipTimer: ReturnType<typeof setTimeout> | undefined;
  private resizeObserver: ResizeObserver | null = null;
  private listening = false;
  private lastRects: OverlayRect[] = [];
  private showToken = 0;

  constructor(private readonly options: OverlayOptions = {}) {
    this.doc = options.doc ?? document;
    this.layout = options.layout ?? browserLayout;
  }

  /** Clears the previous highlight, scrolls to the focused item, then draws everything. */
  async show(request: ShowRequest): Promise<void> {
    this.clear();
    if (request.targets.length === 0) return;
    const token = (this.showToken += 1);
    const layer = this.ensureLayer();
    const first = request.targets[request.focus ?? 0] ?? request.targets[0];
    const shown: Shown = {
      request,
      boxes: [],
      bubble: null,
      content: null,
      arrow: null,
      visible: false,
      dark: first
        ? onDarkBackground(first.kind === 'text' ? first.anchor : first.element, this.layout)
        : false,
    };
    if (request.bubble) {
      const bubble = this.doc.createElement('div');
      bubble.className = 'bubble';
      const content = this.doc.createElement('div');
      const pointer = this.doc.createElement('div');
      pointer.className = 'arrow';
      bubble.append(content, pointer);
      render(
        <Bubble
          content={request.bubble}
          onDismiss={() => {
            this.clear();
          }}
        />,
        content,
      );
      layer.append(bubble);
      shown.bubble = bubble;
      shown.content = content;
      shown.arrow = pointer;
    }
    this.shown = shown;
    this.listen();
    this.restartTimer('highlight');
    if (first) {
      const element = first.kind === 'text' ? first.anchor : first.element;
      await scrollToFree(element, () => this.firstRect(first), {
        layout: this.layout,
        avoid: this.options.avoid?.() ?? [],
        smooth: !this.reducedMotion(),
      });
    }
    if (token !== this.showToken || this.shown !== shown) return;
    shown.visible = true;
    this.update();
  }

  clear(): void {
    this.showToken += 1;
    clearTimeout(this.highlightTimer);
    const shown = this.shown;
    this.shown = null;
    if (shown) {
      for (const box of shown.boxes) box.remove();
      if (shown.content) render(null, shown.content);
      shown.bubble?.remove();
    }
    this.afterChange();
  }

  get hasHighlight(): boolean {
    return this.shown !== null;
  }

  /** Only one chip at a time; it fades after 15 seconds. */
  showChip(request: ChipRequest): void {
    this.dropChip(false);
    const layer = this.ensureLayer();
    const wrap = this.doc.createElement('div');
    wrap.className = 'chip-wrap';
    render(<Chip label={request.label} onActivate={request.onActivate} />, wrap);
    layer.append(wrap);
    this.chip = { request, wrap };
    this.listen();
    this.restartTimer('chip');
    this.update();
    requestAnimationFrame(() => {
      wrap.classList.add('shown');
    });
  }

  hideChips(): void {
    this.dropChip(true);
  }

  /** Removes the chip; `notify` is false when another chip is replacing it. */
  private dropChip(notify: boolean): void {
    clearTimeout(this.chipTimer);
    const chip = this.chip;
    this.chip = null;
    if (chip) {
      render(null, chip.wrap);
      chip.wrap.remove();
      if (notify) this.options.onChipHidden?.();
    }
    this.afterChange();
  }

  get chipElement(): Element | null {
    return this.chip?.request.element ?? null;
  }

  /** What's drawn right now, for IrisDebug.overlayRects(). */
  rects(): OverlayRect[] {
    this.measure();
    return this.lastRects.map((r) => ({ kind: r.kind, rect: { ...r.rect } }));
  }

  destroy(): void {
    this.clear();
    this.hideChips();
    this.host?.remove();
    this.host = null;
    this.layer = null;
  }

  // --- Internals ---

  private reducedMotion(): boolean {
    return this.doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private ensureLayer(): HTMLDivElement {
    if (this.layer && this.host?.isConnected) return this.layer;
    const host = this.doc.createElement('iris-overlay');
    host.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:2147483646;display:block;';
    const root = host.attachShadow({ mode: 'open' });
    const style = this.doc.createElement('style');
    style.textContent = OVERLAY_CSS;
    const layer = this.doc.createElement('div');
    layer.className = 'layer';
    root.append(style, layer);
    this.doc.documentElement.append(host);
    this.host = host;
    this.layer = layer;
    return layer;
  }

  private restartTimer(kind: 'highlight' | 'chip'): void {
    if (kind === 'highlight') {
      clearTimeout(this.highlightTimer);
      this.highlightTimer = setTimeout(() => {
        this.clear();
      }, this.options.highlightMs ?? HIGHLIGHT_MS);
    } else {
      clearTimeout(this.chipTimer);
      this.chipTimer = setTimeout(() => {
        this.hideChips();
      }, this.options.chipMs ?? CHIP_MS);
    }
  }

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || (!this.shown && !this.chip)) return;
    this.clear();
    this.hideChips();
    this.options.onEscape?.();
  };

  private readonly schedule = () => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  };

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    const win = this.doc.defaultView;
    win?.addEventListener('scroll', this.schedule, { capture: true, passive: true });
    win?.addEventListener('resize', this.schedule, { passive: true });
    this.doc.addEventListener('keydown', this.onKey, true);
    this.resizeObserver = new ResizeObserver(this.schedule);
    this.resizeObserver.observe(this.doc.documentElement);
  }

  private afterChange(): void {
    if (this.shown || this.chip || !this.listening) return;
    this.listening = false;
    const win = this.doc.defaultView;
    win?.removeEventListener('scroll', this.schedule, { capture: true });
    win?.removeEventListener('resize', this.schedule);
    this.doc.removeEventListener('keydown', this.onKey, true);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.lastRects = [];
  }

  private firstRect(target: DrawTarget): Rect | null {
    if (target.kind === 'element') return targetRect(target.element, this.layout);
    return union(lineRects(target.range));
  }

  /** Geometry for everything shown, without touching the DOM. */
  private measure(): { boxes: (OverlayRect & { radius: number })[]; anchor: Rect | null } {
    const boxes: (OverlayRect & { radius: number })[] = [];
    let anchor: Rect | null = null;
    const shown = this.shown;
    if (shown?.visible) {
      const { targets, level } = shown.request;
      const focus = shown.request.focus ?? 0;
      for (const [index, target] of targets.entries()) {
        let itemBox: Rect | null = null;
        if (target.kind === 'element') {
          const rect = target.element.isConnected ? targetRect(target.element, this.layout) : null;
          if (rect) {
            itemBox = grow(rect, RING_GAP);
            boxes.push({
              kind: level === 'risk' ? 'risk_ring' : 'ring',
              rect: itemBox,
              radius: ringRadius(target.element, this.layout),
            });
          }
        } else {
          const lines = lineRects(target.range);
          for (const line of lines) boxes.push({ kind: 'marker', rect: line, radius: 3 });
          itemBox = lines[0] ?? null;
        }
        if (itemBox && (index === focus || !anchor)) anchor = itemBox;
        if (itemBox && targets.length > 1) {
          boxes.push({ kind: 'badge', rect: badgeRect(itemBox), radius: 9 });
        }
      }
    }
    this.lastRects = boxes.map(({ kind, rect }) => ({ kind, rect }));
    if (shown?.visible && shown.bubble && anchor) {
      this.lastRects.push({ kind: 'bubble', rect: this.layout.rect(shown.bubble) });
    }
    if (this.chip) this.lastRects.push({ kind: 'chip', rect: this.layout.rect(this.chip.wrap) });
    return { boxes, anchor };
  }

  private update(): void {
    const layer = this.layer;
    if (!layer) return;
    const { boxes, anchor } = this.measure();
    const shown = this.shown;
    if (shown) {
      while (shown.boxes.length < boxes.length) {
        const div = this.doc.createElement('div');
        layer.prepend(div);
        shown.boxes.push(div);
      }
      while (shown.boxes.length > boxes.length) shown.boxes.pop()?.remove();
      let badgeNumber = 0;
      boxes.forEach((box, index) => {
        const div = shown.boxes[index];
        if (!div) return;
        const kindClass =
          box.kind === 'marker'
            ? `marker${shown.dark ? ' dark' : ''}`
            : box.kind === 'badge'
              ? 'badge'
              : `ring${box.kind === 'risk_ring' ? ' risk' : ''}`;
        div.className = `box ${kindClass}${shown.visible ? ' shown' : ''}`;
        div.style.cssText = `left:${box.rect.x}px;top:${box.rect.y}px;width:${box.rect.width}px;height:${box.rect.height}px;border-radius:${box.radius}px;`;
        if (box.kind === 'badge') {
          badgeNumber += 1;
          div.textContent = String(badgeNumber);
        } else div.textContent = '';
      });
      const first = shown.request.targets[shown.request.focus ?? 0] ?? shown.request.targets[0];
      if (shown.bubble && anchor && first) {
        const context = first.kind === 'text' ? first.anchor : first.element;
        this.place(shown.bubble, virtualElement(anchor, context), 'right', [
          'bottom',
          'left',
          'top',
        ]);
        if (shown.visible) shown.bubble.classList.add('shown');
      }
    }
    const chip = this.chip;
    if (chip) {
      const rect = chip.request.element.isConnected
        ? targetRect(chip.request.element, this.layout)
        : null;
      if (rect) this.place(chip.wrap, virtualElement(rect, chip.request.element), 'right', ['top']);
      else this.hideChips();
    }
  }

  /** The viewport minus the widget, so bubbles and chips never sit on top of Iris. */
  private boundary(): Rect | undefined {
    const avoid = this.options.avoid?.() ?? [];
    if (avoid.length === 0) return undefined;
    const width = this.doc.documentElement.clientWidth;
    const height = this.doc.documentElement.clientHeight;
    let free: Rect = { x: 0, y: 0, width, height };
    for (const rect of avoid) {
      const left = { ...free, width: Math.max(0, Math.min(free.width, rect.x - free.x)) };
      const above = { ...free, height: Math.max(0, Math.min(free.height, rect.y - free.y)) };
      free = left.width * left.height >= above.width * above.height ? left : above;
    }
    return free.width > 120 && free.height > 80 ? free : undefined;
  }

  private place(
    floating: HTMLElement,
    reference: ReturnType<typeof virtualElement>,
    placement: Placement,
    fallbackPlacements: Placement[],
    pointer: HTMLElement | null = null,
  ): void {
    const rootBoundary = this.boundary();
    void computePosition(reference, floating, {
      strategy: 'fixed',
      placement,
      middleware: [
        offset(8),
        flip({ fallbackPlacements, ...(rootBoundary ? { rootBoundary } : {}) }),
        shift({ padding: 8, ...(rootBoundary ? { rootBoundary } : {}) }),
        ...(pointer ? [arrow({ element: pointer, padding: 10 })] : []),
      ],
    }).then(({ x, y, placement: side, middlewareData }) => {
      floating.style.left = `${x}px`;
      floating.style.top = `${y}px`;
      const data = middlewareData.arrow;
      if (!pointer || !data) return;
      // The 8 px pointer sits on the side facing the element.
      const facing = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }[
        side.split('-')[0] ?? 'right'
      ];
      pointer.style.cssText = `left:${data.x === undefined ? '' : `${data.x}px`};top:${
        data.y === undefined ? '' : `${data.y}px`
      };${facing ?? 'left'}:-4px;`;
    });
  }
}
