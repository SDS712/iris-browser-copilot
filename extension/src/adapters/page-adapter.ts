/**
 * How core talks to the page. The widget calls the page layer directly; the
 * side panel sends messages to the content script. Both look the same from here.
 */
import type { PageSnapshot, PointerHint, RiskCategory, Severity } from '../core/api';
import type { OverlayRect } from '../page/overlay/overlay';

export interface HighlightRequest {
  ids: string[];
  /** Exact page text to mark inside the first highlighted section. */
  quote_text?: string | null;
  /** A short note for the bubble (at most 80 characters from the agent). */
  note?: string | null;
  /** Bubble title, for nudges ("Pre-ticked · ₹1,299 a year"). */
  title?: string | null;
  risk?: { severity: Severity; category: RiskCategory } | null;
  level: 'normal' | 'risk';
  /** Which item to scroll to (index into ids); the others stay highlighted. */
  focus?: number;
}

export interface HighlightResult {
  found: string[];
  missing: string[];
}

export type ChipKind = 'explain' | 'cookie' | 'trust' | 'hover' | 'terms' | 'risks';

export interface ChipRequest {
  element_id: string;
  label: string;
  kind: ChipKind;
}

export interface ElementDescription {
  tag: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
}

export type PageEvent =
  | { type: 'page-changed'; revision: number; captured_at: string; navigation: boolean }
  | { type: 'hesitation'; element_id: string }
  /** A field or checkbox Iris has read got focus: its ID only. */
  | { type: 'control-focus'; element_id: string }
  /** The mouse rested 2 s on a clause or price: its price or section ID. */
  | { type: 'dwell'; element_id: string; section_id: string | null; price_id: string | null }
  | { type: 'cookie_banner'; element_id: string }
  | { type: 'legal_links_near_submit'; element_id: string }
  | { type: 'chip-clicked'; kind: ChipKind; element_id: string }
  /** The chip went away by itself (15 s, typing, leaving the field, Esc). */
  | { type: 'chip-hidden' };

export interface PageAdapter {
  getSnapshot(): Promise<PageSnapshot>;
  /** Draws at once; resolves with what was found, without waiting for scrolling. */
  highlight(request: HighlightRequest): Promise<HighlightResult>;
  clearHighlights(): Promise<void>;
  showChip(request: ChipRequest): Promise<void>;
  hideChips(): Promise<void>;
  describeElement(id: string): Promise<ElementDescription | null>;
  overlayRects(): Promise<OverlayRect[]>;
  /** What "this" means: what the user last pointed at or clicked into. */
  pointerHint(): Promise<PointerHint | null>;
  onPageEvent(callback: (event: PageEvent) => void): () => void;
}
