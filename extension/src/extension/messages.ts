/**
 * The extension's typed messages. The side panel talks to the active tab's
 * content script; content scripts report to the panel and the background. Every handler
 * checks the message came from this extension, and content scripts never take requests
 * from the page.
 */
import type { ChipKind, ChipRequest, HighlightRequest, PageEvent } from '../adapters/page-adapter';

/** Panel → content script. */
export type ContentRequest =
  | { type: 'iris/get-snapshot' }
  | { type: 'iris/highlight'; request: HighlightRequest }
  | { type: 'iris/clear-highlights' }
  | { type: 'iris/show-chip'; request: ChipRequest }
  | { type: 'iris/hide-chips' }
  | { type: 'iris/describe-element'; id: string }
  | { type: 'iris/overlay-rects' }
  | { type: 'iris/pointer-hint' };

/** Every content-script reply: a value, or the error that stopped it. */
export type ContentReply<T> = { ok: true; value: T } | { ok: false; error: string };

/** Content script → panel and background (runtime.sendMessage reaches both). */
export type ContentReport =
  | { type: 'iris/page-event'; event: PageEvent }
  | { type: 'iris/flag-counts'; high: number; medium: number }
  | { type: 'iris/chip-clicked'; kind: ChipKind; element_id: string }
  /** Is the panel following this tab? If so, it owns the chips. */
  | { type: 'iris/panel-attached' };

/** Background → panel, over the "sidepanel" port. */
export type PanelNotice =
  { type: 'iris/command'; command: 'toggle-iris' } | { type: 'iris/intent' };

/** Panel → background, over the port or as a message. */
export type PanelRequest =
  | { type: 'iris/attach'; windowId: number; tabId: number | null }
  | { type: 'iris/take-intent'; windowId: number };

/** A chip tapped while the panel was closed, kept until the panel collects it. */
export interface PendingIntent {
  tabId: number;
  kind: ChipKind | 'toggle';
  element_id: string | null;
}

export const PANEL_PORT = 'sidepanel';

interface SenderLike {
  id?: string;
}

/** True when a message came from this extension (its own pages or content scripts). */
export function fromThisExtension(sender: SenderLike, extensionId: string): boolean {
  return sender.id === extensionId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isContentRequest(value: unknown): value is ContentRequest {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    [
      'iris/get-snapshot',
      'iris/highlight',
      'iris/clear-highlights',
      'iris/show-chip',
      'iris/hide-chips',
      'iris/describe-element',
      'iris/overlay-rects',
      'iris/pointer-hint',
    ].includes(value.type)
  );
}

export function isContentReport(value: unknown): value is ContentReport {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    ['iris/page-event', 'iris/flag-counts', 'iris/chip-clicked', 'iris/panel-attached'].includes(
      value.type,
    )
  );
}

export function isPanelRequest(value: unknown): value is PanelRequest {
  return isRecord(value) && (value.type === 'iris/attach' || value.type === 'iris/take-intent');
}

export function isPanelNotice(value: unknown): value is PanelNotice {
  return isRecord(value) && (value.type === 'iris/command' || value.type === 'iris/intent');
}

/** Toolbar badge: high and medium flags; red if any are high. */
export function badgeFor(high: number, medium: number): { text: string; color: string } {
  const count = high + medium;
  return { text: count > 0 ? String(count) : '', color: high > 0 ? '#B42318' : '#B54708' };
}
