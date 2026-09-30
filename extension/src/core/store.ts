/** All interface state, as Preact signals. The UI reads only from here. */
import { signal } from '@preact/signals';
import type { PageType, ScanResult, ToolResult } from './api';
import { DEFAULT_SETTINGS, type IrisSettings, type VoiceChoice } from './settings';

export type SessionState =
  'idle' | 'connecting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'muted' | 'error';

export interface TranscriptLine {
  id: number;
  who: 'you' | 'iris';
  text: string;
}

export type NoticeKind = 'error' | 'mic' | 'limit' | 'closed' | 'timeout' | 'info' | 'nudges_off';

export interface Notice {
  kind: NoticeKind;
  message: string;
}

/** The page Iris is looking at, once registered with the backend. */
export interface CurrentPage {
  page_id: string;
  page_type: PageType;
  url: string;
  summary_for_agent: string;
  truncated: boolean;
  /** Null while the background scan is pending. */
  scan: ScanResult | null;
}

/** "none": nothing read yet; "unsupported": a page Iris can't read (chrome://, the Web Store). */
export type PageStatus = 'none' | 'reading' | 'ready' | 'unsupported' | 'unreachable';

/** One card in the stack: a loading placeholder until its tool responds. */
export interface CardEntry {
  id: string;
  tool: string;
  /** Loading text, the same as the orb caption. */
  caption: string;
  result: ToolResult | null;
}

/** The walkthrough's current stop, for the tour bar. */
export interface TourState {
  page_id: string;
  /** The section's ID (page walkthrough), or the part's or field's key (form). */
  key: string;
  heading: string | null;
  /** The one-sentence explanation shown and spoken for this stop. */
  say: string;
  risk_ids: string[];
  /** 0-based. */
  index: number;
  total: number;
}

export interface Chip {
  element_id: string;
  label: string;
}

export const MAX_CARDS = 20;

export function createStore(settings: IrisSettings = DEFAULT_SETTINGS) {
  return {
    session: {
      state: signal<SessionState>('idle'),
      /** Orb caption while a tool runs ("Checking the terms…"). */
      toolCaption: signal<string | null>(null),
      /** What the user is saying right now (replaced on each delta). */
      userLive: signal(''),
      /** What Iris is saying right now (word by word). */
      agentLive: signal(''),
      transcript: signal<TranscriptLine[]>([]),
      /** Say lines spoken or captioned this session (IrisDebug.getState().spoken). */
      spoken: signal<string[]>([]),
      inputLevel: signal(0),
      outputLevel: signal(0),
      muted: signal(false),
      /** False once the microphone was denied or unavailable: typed-only mode. */
      micAvailable: signal(true),
      /** Playback is blocked until the user taps ("Tap to hear Iris"). */
      audioSuspended: signal(false),
      /** A session carried over from the previous page: audio waits for any click. */
      quietResume: signal(false),
      /** The user said "stop suggesting": no nudges for the rest of this session. */
      nudgesOff: signal(false),
      /** Chimes played before Iris spoke up by itself (IrisDebug.getState().cues). */
      cues: signal(0),
      /** The voice this session speaks with, fixed when it started; null with no session. */
      voice: signal<VoiceChoice | null>(null),
    },
    page: signal<CurrentPage | null>(null),
    pageStatus: signal<PageStatus>('none'),
    /** Cards for the current page, newest first. */
    cards: signal<CardEntry[]>([]),
    expandedCard: signal<string | null>(null),
    highlightIds: signal<string[]>([]),
    /** The guided walkthrough's current stop, or null. */
    tour: signal<TourState | null>(null),
    chips: signal<Chip[]>([]),
    settings: signal<IrisSettings>(settings),
    /** Extension: the microphone isn't granted yet, so show the permission view. */
    micPrompt: signal(false),
    notice: signal<Notice | null>(null),
  };
}

export type IrisStore = ReturnType<typeof createStore>;

let nextLineId = 1;

export function addTranscriptLine(store: IrisStore, who: TranscriptLine['who'], text: string) {
  const line = { id: nextLineId++, who, text };
  store.session.transcript.value = [...store.session.transcript.value, line];
  return line.id;
}

export function replaceTranscriptLine(store: IrisStore, id: number, text: string) {
  store.session.transcript.value = store.session.transcript.value.map((line) =>
    line.id === id ? { ...line, text } : line,
  );
}

let nextCardId = 1;

/** Adds a loading card on top and expands it. Returns its ID. */
export function addLoadingCard(store: IrisStore, tool: string, caption: string): string {
  const id = `card-${nextCardId++}`;
  store.cards.value = [{ id, tool, caption, result: null }, ...store.cards.value].slice(
    0,
    MAX_CARDS,
  );
  store.expandedCard.value = id;
  return id;
}

/**
 * Fills a loading card, or removes it when the tool returned no card. An older card with
 * the same content goes: a spoken nudge and the scan the user then asks for would
 * otherwise stack two identical cards.
 */
export function settleCard(store: IrisStore, id: string, result: ToolResult | null) {
  if (!result?.card) {
    removeCard(store, id);
    return;
  }
  const same = JSON.stringify(result.card);
  store.cards.value = store.cards.value
    .filter((entry) => entry.id === id || JSON.stringify(entry.result?.card) !== same)
    .map((entry) => (entry.id === id ? { ...entry, result } : entry));
}

export function removeCard(store: IrisStore, id: string) {
  store.cards.value = store.cards.value.filter((entry) => entry.id !== id);
  if (store.expandedCard.value === id) store.expandedCard.value = store.cards.value[0]?.id ?? null;
}

/** Adds a finished card on top (cards opened by the interface, like "Review"). */
export function addCard(store: IrisStore, tool: string, result: ToolResult): string {
  const id = addLoadingCard(store, tool, '');
  settleCard(store, id, result);
  return id;
}
