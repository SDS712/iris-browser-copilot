/**
 * Carrying a voice session to the next page of the same site, in the same tab.
 * sessionStorage belongs to one tab, so another tab never picks the session up.
 */
import type { SessionHandover } from '../core/session';

export const HANDOVER_KEY = 'iris.handover';
/** Inside AssemblyAI's 30-second resume window, with time left to connect. */
export const HANDOVER_MAX_AGE_MS = 25_000;

export interface SavedHandover extends SessionHandover {
  /** When the old page went (ms since the epoch). */
  at: number;
  muted: boolean;
}

export function saveHandover(
  handover: SessionHandover,
  muted: boolean,
  storage: Storage = sessionStorage,
  now = Date.now(),
): void {
  try {
    const saved: SavedHandover = { ...handover, at: now, muted };
    storage.setItem(HANDOVER_KEY, JSON.stringify(saved));
  } catch {
    // Blocked storage: the next page starts without a session, as before.
  }
}

/** The handover from the previous page, if it's fresh enough to resume; read once. */
export function takeHandover(
  storage: Storage = sessionStorage,
  now = Date.now(),
): SavedHandover | null {
  try {
    const raw = storage.getItem(HANDOVER_KEY);
    storage.removeItem(HANDOVER_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<SavedHandover>;
    if (typeof saved.session_id !== 'string' || typeof saved.at !== 'number') return null;
    if (now - saved.at > HANDOVER_MAX_AGE_MS) return null;
    return {
      session_id: saved.session_id,
      started_at: typeof saved.started_at === 'number' ? saved.started_at : now,
      at: saved.at,
      muted: saved.muted === true,
      ...(saved.voice === 'female' || saved.voice === 'male' ? { voice: saved.voice } : {}),
    };
  } catch {
    return null;
  }
}

interface NavigateEventLike extends Event {
  destination: { url: string; sameDocument: boolean };
  downloadRequest: string | null;
}

/**
 * Whether the page is leaving for another page of this site: a link, a form, a reload or
 * back and forward, as the Navigation API reports them. Browsers without it (Firefox,
 * Safari) always say no, so the session ends on pagehide as before.
 */
export function watchLeaving(win: Window = window): () => boolean {
  let destination: string | null = null;
  const navigation = (win as unknown as { navigation?: EventTarget }).navigation;
  navigation?.addEventListener('navigate', (event) => {
    const { destination: next, downloadRequest } = event as NavigateEventLike;
    if (!next.sameDocument && downloadRequest === null) destination = next.url;
  });
  navigation?.addEventListener('navigateerror', () => {
    destination = null;
  });
  return () => {
    if (!destination) return false;
    try {
      return new URL(destination).origin === win.location.origin;
    } catch {
      return false;
    }
  };
}
