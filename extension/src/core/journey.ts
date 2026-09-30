/**
 * The journey in one tab: the last 10 pages the user visited, with a few facts
 * each, and a rolling summary of the pages before them. The agent gets it in the page
 * context; ask_page reads the earlier pages; figures that change between pages of the same
 * site become a nudge. It holds no page text, and it's forgotten 30 minutes after the last
 * activity (project rule 4).
 */
import type { PageSnapshot, PageType } from './api';

export const TRAIL_PAGES = 10;
export const JOURNEY_IDLE_MS = 30 * 60_000;
/** A page left sooner than this was a redirect or a bounce. */
export const BOUNCE_MS = 3_000;
/** Pages with less text than this and no fields or prices aren't worth remembering. */
export const THIN_TEXT_CHARS = 200;
export const CONTEXT_CHARS = 2_500;
export const SUMMARY_CHARS = 1_200;
const FACT_CHARS = 300;
const FACT_PRICES = 4;

export interface JourneyPrice {
  id: string;
  label: string;
  amount_inr: number;
  amount_text: string;
}

/** The loan terms of a flat-rate offer, from the client flag's params. */
export interface JourneyRate {
  element_id: string;
  rate_percent: number;
  rate_basis: string;
  tenure_months: number | null;
  principal_inr: number | null;
}

export interface JourneyEntry {
  page_id: string;
  url: string;
  title: string;
  page_type: PageType;
  visited_at: number;
  prices: JourneyPrice[];
  rate: JourneyRate | null;
  thin: boolean;
  risks: string[];
}

export interface JourneyState {
  /** Oldest first; the last entry is the current page. */
  entries: JourneyEntry[];
  summary: string | null;
  last_active: number;
}

/** Where a tab's journey lives: sessionStorage in the widget, memory in the side panel. */
export interface JourneyStorage {
  load(): JourneyState | null;
  save(state: JourneyState | null): void;
}

export function memoryStorage(): JourneyStorage {
  let state: JourneyState | null = null;
  return {
    load: () => state,
    save: (next) => {
      state = next;
    },
  };
}

/** sessionStorage is per tab and survives page loads; it can throw, or be missing. */
export function sessionJourneyStorage(key = 'iris.journey'): JourneyStorage {
  return {
    load() {
      try {
        const raw = sessionStorage.getItem(key);
        return raw ? (JSON.parse(raw) as JourneyState) : null;
      } catch {
        return null;
      }
    },
    save(state) {
      try {
        if (state) sessionStorage.setItem(key, JSON.stringify(state));
        else sessionStorage.removeItem(key);
      } catch {
        // Private windows and blocked storage: the journey just lasts one page.
      }
    },
  };
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The facts Iris keeps about a page: labelled prices and a flat-rate offer's terms. */
export function entryFor(
  pageId: string,
  pageType: PageType,
  snapshot: PageSnapshot,
  visitedAt: number,
): JourneyEntry {
  // Only labelled amounts can be compared between pages.
  const prices = snapshot.prices.flatMap((price) =>
    price.label && price.amount_inr !== null
      ? [
          {
            id: price.id,
            label: price.label,
            amount_inr: price.amount_inr,
            amount_text: price.amount_text,
          },
        ]
      : [],
  );
  const flag = snapshot.client_flags.find((f) => f.rule === 'flat_rate_offer');
  const ratePercent = num(flag?.params.rate_percent);
  const rate =
    flag && ratePercent !== null
      ? {
          element_id: flag.element_ids[0] ?? '',
          rate_percent: ratePercent,
          rate_basis: String(flag.params.rate_basis ?? ''),
          tenure_months: num(flag.params.tenure_months),
          principal_inr: num(flag.params.principal_inr),
        }
      : null;
  const text = snapshot.sections.reduce((sum, section) => sum + section.text.length, 0);
  return {
    page_id: pageId,
    url: snapshot.url,
    title: snapshot.title,
    page_type: pageType,
    visited_at: visitedAt,
    prices,
    rate,
    thin: text < THIN_TEXT_CHARS && snapshot.fields.length === 0 && prices.length === 0,
    risks: [],
  };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** The URL without its fragment: "#section" links don't make a new page. */
function pageKey(url: string): string {
  return url.split('#')[0] ?? url;
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function rateText(rate: JourneyRate): string {
  const basis = rate.rate_basis.replace(/_/g, ' ');
  const tenure = rate.tenure_months === null ? '' : `, ${String(rate.tenure_months)} months`;
  return `${String(rate.rate_percent)}% ${basis}${tenure}`;
}

/** One line per page for the agent and the summary: title, type, site, figures, risks. */
export function factLine(entry: JourneyEntry): string {
  const parts = [`${entry.title || entry.url} (${entry.page_type}, ${hostOf(entry.url)})`];
  const prices = entry.prices.slice(0, FACT_PRICES).map((p) => `${p.label} ${p.amount_text}`);
  if (prices.length > 0) parts.push(prices.join('; '));
  if (entry.rate) parts.push(`rate ${rateText(entry.rate)}`);
  if (entry.risks.length > 0) parts.push(`risks: ${entry.risks.slice(0, 2).join('; ')}`);
  return clip(parts.join(': '), FACT_CHARS);
}

/** The summary without a model: used until the model's arrives, or if it fails. */
export function digest(previous: string | null, entries: readonly JourneyEntry[]): string {
  const lines = entries.map(factLine);
  return clip([previous, ...lines].filter(Boolean).join(' | '), SUMMARY_CHARS);
}

export interface JourneyDeps {
  storage: JourneyStorage;
  /** POST /api/journey/summary: the fact lines (oldest first) and the summary so far. */
  summarise(facts: string[], previous: string | null): Promise<string>;
  /** The journey changed in a way the agent should hear about. */
  onChange?: () => void;
  now?: () => number;
}

export class JourneyTrail {
  constructor(private readonly deps: JourneyDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The journey, or null once it's been idle for 30 minutes. */
  private get state(): JourneyState | null {
    const state = this.deps.storage.load();
    if (state && this.now() - state.last_active > JOURNEY_IDLE_MS) {
      this.deps.storage.save(null);
      return null;
    }
    return state;
  }

  private save(state: JourneyState): void {
    this.deps.storage.save({ ...state, last_active: this.now() });
  }

  /** A question, a tool call or a page: the 30 idle minutes start again. */
  touch(): void {
    const state = this.state;
    if (state) this.save(state);
  }

  get entries(): readonly JourneyEntry[] {
    return this.state?.entries ?? [];
  }

  get summary(): string | null {
    return this.state?.summary ?? null;
  }

  /** The current page's entry. */
  get current(): JourneyEntry | null {
    return this.entries.at(-1) ?? null;
  }

  /** Earlier pages, newest first. */
  earlier(): JourneyEntry[] {
    return this.entries.slice(0, -1).reverse();
  }

  /** For ask_page: the earlier pages' IDs, newest first (the backend skips expired ones). */
  earlierPageIds(): string[] {
    return this.earlier()
      .map((entry) => entry.page_id)
      .slice(0, TRAIL_PAGES - 1);
  }

  /**
   * A page registered in this tab. `sameDocument` is a new snapshot of the page already
   * current (a single-page app's revision, or a fee that appeared): it replaces that entry.
   */
  arrive(entry: JourneyEntry, sameDocument: boolean): void {
    const state = this.state ?? { entries: [], summary: null, last_active: this.now() };
    const entries = [...state.entries];
    const last = entries.at(-1);
    if (sameDocument && last && pageKey(last.url) === pageKey(entry.url)) {
      entries[entries.length - 1] = { ...entry, visited_at: last.visited_at, risks: last.risks };
      this.save({ ...state, entries });
      return;
    }
    // The page being left: a bounce or a near-empty page isn't worth remembering.
    if (last && (last.thin || entry.visited_at - last.visited_at < BOUNCE_MS)) entries.pop();
    const revisit = entries.findIndex((e) => pageKey(e.url) === pageKey(entry.url));
    if (revisit >= 0) entries.splice(revisit, 1);
    if (entries.length >= TRAIL_PAGES) {
      this.rollOver(state.summary, entries, entry);
      return;
    }
    this.save({ ...state, entries: [...entries, entry] });
    this.deps.onChange?.();
  }

  /** The scan's risks for a page, once it's ready. */
  noteRisks(pageId: string, risks: string[]): void {
    const state = this.state;
    const entry = state?.entries.find((e) => e.page_id === pageId);
    if (!state || !entry || entry.risks.join() === risks.join()) return;
    entry.risks = risks;
    this.save(state);
    this.deps.onChange?.();
  }

  /** The 11th page: the 10 before it become the summary, and a new list starts. */
  private rollOver(previous: string | null, folded: JourneyEntry[], entry: JourneyEntry): void {
    this.save({ entries: [entry], summary: digest(previous, folded), last_active: this.now() });
    this.deps.onChange?.();
    this.deps.summarise(folded.map(factLine), previous).then(
      (summary) => {
        const state = this.state;
        if (!state) return;
        this.save({ ...state, summary: clip(summary, SUMMARY_CHARS) });
        this.deps.onChange?.();
      },
      () => {
        // The code-built digest stays.
      },
    );
  }

  /** What the agent gets after the current page's context, at most 2,500 characters. */
  contextBlock(): string {
    const lines = this.earlier().map((entry) => `- ${factLine(entry)}`);
    const summary = this.summary;
    const parts: string[] = [];
    if (lines.length > 0) parts.push(`EARLIER IN THIS TAB (newest first):\n${lines.join('\n')}`);
    if (summary) parts.push(`EARLIER NAVIGATION SUMMARY: ${summary}`);
    return clip(parts.join('\n'), CONTEXT_CHARS);
  }
}

// --- Figures that change between pages of the same site ---

export interface JourneyFinding {
  key: string;
  say: string;
  element_id: string;
}

function normalLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PAGE_NAMES: Partial<Record<PageType, string>> = {
  offer: 'the offer page',
  checkout: 'the checkout page',
  terms: 'the terms',
  privacy: 'the privacy policy',
  form: 'the application form',
};

/** How Iris names an earlier page: by its kind, or by its title when that's ambiguous. */
export function pageName(entry: JourneyEntry, current: JourneyEntry): string {
  const byType = entry.page_type === current.page_type ? undefined : PAGE_NAMES[entry.page_type];
  // Curly quotes: the line itself goes to the agent inside straight ones (COPY.sayExactly).
  return byType ?? `the page “${clip(entry.title, 60)}”`;
}

/**
 * The first figure on this page that an earlier page of the same site gave differently:
 * the same price label with another amount, or a flat rate with other terms. Code only.
 */
export function compareWithEarlier(
  current: JourneyEntry,
  earlier: readonly JourneyEntry[],
): JourneyFinding | null {
  const host = hostOf(current.url);
  const sameSite = earlier.filter((e) => hostOf(e.url) === host && e.page_id !== current.page_id);
  for (const price of current.prices) {
    const label = normalLabel(price.label);
    if (!label) continue;
    for (const entry of sameSite) {
      const before = entry.prices.find((p) => normalLabel(p.label) === label);
      if (before && before.amount_inr !== price.amount_inr) {
        return {
          key: `journey:${label}:${String(before.amount_inr)}:${String(price.amount_inr)}`,
          say: `Heads up: the ${label} here is ${price.amount_text}, but ${pageName(entry, current)} said ${before.amount_text}.`,
          element_id: price.id,
        };
      }
    }
  }
  const rate = current.rate;
  if (rate) {
    for (const entry of sameSite) {
      const before = entry.rate;
      if (!before || rateText(before) === rateText(rate)) continue;
      return {
        key: `journey:rate:${rateText(before)}:${rateText(rate)}`,
        say: `Heads up: the rate here is ${rateText(rate)}, but ${pageName(entry, current)} said ${rateText(before)}.`,
        element_id: rate.element_id,
      };
    }
  }
  return null;
}
