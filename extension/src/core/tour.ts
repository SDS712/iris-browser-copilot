/**
 * The guided walkthrough: the page's sections in order, or a form's parts
 * or fields, one stop at a time. Each stop highlights its place on the page, shows a
 * line in the tour bar and gives the agent a line to speak. Explanations come 5 stops at a
 * time, fetched just ahead. A form walkthrough also follows the user's clicks into the form.
 */
import type { PageAdapter } from '../adapters/page-adapter';
import type { FormStep, IrisApi, PageSnapshot } from './api';
import { COPY } from './copy';
import type { VoiceSessionLike } from './session';
import type { IrisStore } from './store';

export const BATCH = 5;
/** Fetch the next batch once this few explained stops are left ahead. */
export const PREFETCH_WHEN_LEFT = 2;
/** Tabbing through fields doesn't move the walkthrough: focus must stay this long. */
export const FOLLOW_DELAY_MS = 700;
/** How long a followed step waits for Iris to finish speaking before it's said. */
export const FOLLOW_WAIT_MS = 10_000;
/** Unheaded blocks shorter than this are page chrome (a footer line, a breadcrumb). */
const CHROME_CHARS = 60;
const CONTINUED = ' (cont.)';
const NUMBERING_RE = /^\s*\d+(?:\.\d+)*[.)]?\s+/;
const SENTENCE_RE = /(?<=[.!?])\s+/;
const FALLBACK_WORDS = 30;
/** Checkboxes have no part of their own in the snapshot. */
const CHECKBOX_PART = 'Checkboxes';

export type TourAction = 'start' | 'next' | 'back' | 'repeat' | 'stop';
export type TourMode = 'page' | 'form';

/** Words that move a running walkthrough, typed or said on their own. */
const COMMANDS: Record<string, TourAction | undefined> = {
  next: 'next',
  'next please': 'next',
  'go on': 'next',
  continue: 'next',
  back: 'back',
  'go back': 'back',
  again: 'repeat',
  repeat: 'repeat',
  stop: 'stop',
  'stop the walkthrough': 'stop',
};

/** "Next." → next; anything longer is a question, not a command. */
export function tourCommand(text: string): TourAction | null {
  return (
    COMMANDS[
      text
        .trim()
        .toLowerCase()
        .replace(/[.!?,]+$/, '')
    ] ?? null
  );
}

export const TOUR_LINES = {
  nothing: "There isn't much on this page to walk through.",
  notRunning: "There's no walkthrough running. Ask me to walk you through the page to start one.",
  intro: (total: number) =>
    `This page has ${String(total)} parts; I'll go through them one by one.`,
  formIntro: (total: number, perField: boolean) =>
    `This form has ${String(total)} ${perField ? 'fields' : 'parts'}; I'll take you through them one by one. Ask me about any field you're unsure of.`,
  done: "That's the whole page.",
  formDone: "That's the whole form. Check it over before you submit.",
  stopped: 'Okay, stopping the walkthrough.',
} as const;

/** reply.create instructions when the walkthrough followed a click. */
export const FOLLOWED =
  'The user clicked into another part of the form, so the walkthrough moved there.';

export interface TourStop {
  /** The section's ID (page), or the part's or field's key (form). */
  key: string;
  heading: string | null;
  /** What's highlighted: the section, or the part's fields and boxes. */
  ids: string[];
}

interface Explained {
  say: string;
  risk_ids: string[];
}

/** Every section worth a stop, in page order: no empty ones, no chrome, no split-off parts. */
export function tourStops(snapshot: PageSnapshot): TourStop[] {
  return snapshot.sections
    .filter((section) => section.text.trim().length > 0)
    .filter((section) => !section.heading?.endsWith(CONTINUED))
    .filter((section) => section.heading !== null || section.text.length >= CHROME_CHARS)
    .map((section) => ({ key: section.id, heading: section.heading, ids: [section.id] }));
}

interface FormItem {
  ids: string[];
  label: string;
  part: string | null;
  order: number;
}

/** "i-12" → 12: IDs are given in reading order, so this is the page order. */
function order(id: string): number {
  return Number(/\d+$/.exec(id)?.[0] ?? Number.MAX_SAFE_INTEGER);
}

/**
 * A form's stops: one per part when the fields come in 2 or more parts
 * (a fieldset legend or a heading), otherwise one per field. A radio group is one item, and
 * checkboxes sit where they appear, in a part of their own.
 */
export function formStops(snapshot: PageSnapshot): TourStop[] {
  const items: FormItem[] = snapshot.fields.map((field) => ({
    ids: [field.id],
    label: field.label,
    part: field.section,
    order: order(field.id),
  }));
  const radios = new Map<string, FormItem>();
  for (const choice of snapshot.checkboxes) {
    const group = choice.kind === 'radio' ? (choice.group ?? choice.label) : null;
    const existing = group ? radios.get(group) : undefined;
    if (existing) {
      existing.ids.push(choice.id);
      continue;
    }
    const item = {
      ids: [choice.id],
      label: group ?? choice.label,
      part: CHECKBOX_PART,
      order: order(choice.id),
    };
    if (group) radios.set(group, item);
    items.push(item);
  }
  items.sort((a, b) => a.order - b.order);
  const parts = new Set(snapshot.fields.map((field) => field.section).filter(Boolean));
  if (parts.size < 2) {
    return items.map((item) => ({
      key: item.ids[0] ?? item.label,
      heading: item.label,
      ids: item.ids,
    }));
  }
  const stops: TourStop[] = [];
  for (const item of items) {
    const last = stops.at(-1);
    if (last && last.heading === item.part) last.ids.push(...item.ids);
    else
      stops.push({
        key: `part-${String(stops.length + 1)}`,
        heading: item.part,
        ids: [...item.ids],
      });
  }
  return stops;
}

/** "7.2 Cancellation" is said "Cancellation": no section numbers aloud. */
export function spokenHeading(heading: string | null): string | null {
  const plain = heading?.replace(NUMBERING_RE, '').trim();
  return plain ? plain : null;
}

/** When the backend can't explain a section: its first sentence, cut to 30 words. */
export function fallbackSay(text: string): string {
  const first = text.trim().split(SENTENCE_RE, 1)[0] ?? '';
  const words = first.split(/\s+/).filter(Boolean);
  return words.length <= FALLBACK_WORDS ? first : `${words.slice(0, FALLBACK_WORDS).join(' ')}…`;
}

/** When the backend can't explain a form step: "This part asks for your A and B." */
export function formFallback(snapshot: PageSnapshot | null, ids: readonly string[]): string {
  const labels = [
    ...(snapshot?.fields ?? []).filter((f) => ids.includes(f.id)).map((f) => f.label),
    ...(snapshot?.checkboxes ?? [])
      .filter((c) => ids.includes(c.id))
      .map((c) => c.group ?? c.label),
  ];
  const names = [...new Set(labels)];
  if (names.length === 0) return '';
  const listed =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
  return `This part asks for your ${listed ?? ''}.`;
}

export interface TourDeps {
  api: Pick<IrisApi, 'walkthrough'>;
  store: IrisStore;
  adapter: PageAdapter | null;
  /** The snapshot the current page_id was registered from. */
  snapshot: () => PageSnapshot | null;
  /** For saying a step the walkthrough moved to by itself (following a click). */
  session?: () => VoiceSessionLike;
  sleep?: (ms: number) => Promise<void>;
}

/** What the agent gets back: the line to speak, and where the tour is. */
export interface TourResult extends Record<string, unknown> {
  say: string;
  step?: number;
  total?: number;
}

export class Tour {
  private stops: TourStop[] = [];
  private pageId: string | null = null;
  private index = 0;
  private kind: TourMode = 'page';
  private explained = new Map<string, Explained>();
  private pending = new Map<string, Promise<void>>();
  private followTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: TourDeps) {}

  get running(): boolean {
    return this.deps.store.tour.value !== null;
  }

  get mode(): TourMode | null {
    return this.running ? this.kind : null;
  }

  async act(action: TourAction, mode?: TourMode): Promise<TourResult> {
    if (action === 'start') return this.start(mode);
    if (!this.running) return { say: TOUR_LINES.notRunning };
    switch (action) {
      case 'next':
        if (this.index + 1 >= this.stops.length) {
          return this.finish(this.kind === 'form' ? TOUR_LINES.formDone : TOUR_LINES.done);
        }
        return this.show(this.index + 1);
      case 'back':
        return this.show(Math.max(0, this.index - 1));
      case 'repeat':
        return this.show(this.index);
      case 'stop':
        return this.finish(TOUR_LINES.stopped);
    }
  }

  /** Navigation, or the session ending: the tour stops without a word. */
  end(): void {
    clearTimeout(this.followTimer);
    if (!this.running) return;
    void this.finish('');
  }

  /**
   * A field or checkbox got focus. During a form walkthrough, once the
   * focus has stayed put a moment, the walkthrough moves to its step, and Iris says it.
   */
  onControlFocus(elementId: string): void {
    clearTimeout(this.followTimer);
    if (this.mode !== 'form') return;
    this.followTimer = setTimeout(() => {
      void this.follow(elementId);
    }, FOLLOW_DELAY_MS);
  }

  private async follow(elementId: string): Promise<void> {
    const index = this.stops.findIndex((stop) => stop.ids.includes(elementId));
    if (this.mode !== 'form' || index < 0 || index === this.index) return;
    const moved = await this.show(index);
    const session = this.deps.session?.();
    if (!session?.isRunning || !(await this.untilListening())) return;
    // A later click may have moved it again while Iris was speaking.
    if (this.index !== index || !this.running) return;
    session.createReply(`${FOLLOWED} ${COPY.sayExactly(moved.say)}`);
  }

  private async untilListening(): Promise<boolean> {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let waited = 0; waited <= FOLLOW_WAIT_MS; waited += 250) {
      if (this.deps.store.session.state.value === 'listening') return true;
      await sleep(250);
    }
    return false;
  }

  private async start(mode?: TourMode): Promise<TourResult> {
    const snapshot = this.deps.snapshot();
    const pageId = this.deps.store.page.value?.page_id ?? null;
    if (!snapshot || !pageId) return { say: TOUR_LINES.nothing };
    const wanted = mode ?? (this.deps.store.page.value?.page_type === 'form' ? 'form' : 'page');
    const formStepsFound = wanted === 'form' ? formStops(snapshot) : [];
    // A page with nothing to fill in gets the page walkthrough instead.
    this.kind = formStepsFound.length > 0 ? 'form' : 'page';
    const stops = this.kind === 'form' ? formStepsFound : tourStops(snapshot);
    if (stops.length === 0) return { say: TOUR_LINES.nothing };
    this.stops = stops;
    this.pageId = pageId;
    this.explained.clear();
    this.pending.clear();
    const first = await this.show(0);
    const perField = new Set(snapshot.fields.map((f) => f.section).filter(Boolean)).size < 2;
    const intro =
      this.kind === 'form'
        ? TOUR_LINES.formIntro(stops.length, perField)
        : TOUR_LINES.intro(stops.length);
    return { ...first, say: `${intro} ${first.say}` };
  }

  private async show(index: number): Promise<TourResult> {
    const { store, adapter } = this.deps;
    const stop = this.stops[index];
    const pageId = this.pageId;
    if (!stop || !pageId) return { say: TOUR_LINES.nothing };
    this.index = index;
    const step = await this.explain(index);
    store.tour.value = {
      page_id: pageId,
      key: stop.key,
      heading: stop.heading,
      say: step.say,
      risk_ids: step.risk_ids,
      index,
      total: this.stops.length,
    };
    if (adapter) {
      const level = step.risk_ids.length > 0 ? 'risk' : 'normal';
      void adapter.highlight({ ids: stop.ids, level }).then((shown) => {
        store.highlightIds.value = shown.found;
      });
    }
    this.prefetch(index);
    const heading = spokenHeading(stop.heading);
    const where = `Step ${String(index + 1)} of ${String(this.stops.length)}.`;
    return {
      say: heading ? `${where} ${heading}. ${step.say}` : `${where} ${step.say}`,
      step: index + 1,
      total: this.stops.length,
    };
  }

  private async finish(say: string): Promise<TourResult> {
    const { store, adapter } = this.deps;
    clearTimeout(this.followTimer);
    store.tour.value = null;
    store.highlightIds.value = [];
    this.stops = [];
    this.pageId = null;
    await adapter?.clearHighlights().catch(() => undefined);
    return { say };
  }

  /** This stop's explanation, fetching its batch if it isn't here yet. */
  private async explain(index: number): Promise<Explained> {
    const stop = this.stops[index];
    if (!stop) return { say: '', risk_ids: [] };
    if (!this.explained.has(stop.key)) {
      await (this.pending.get(stop.key) ?? this.fetchFrom(index));
    }
    return this.explained.get(stop.key) ?? this.fallback(stop);
  }

  /** The next batch in the background, once only a couple of explained stops are left. */
  private prefetch(index: number): void {
    const ahead = this.stops.slice(index + 1, index + 1 + PREFETCH_WHEN_LEFT + 1);
    const missing = ahead.findIndex(
      (stop) => !this.explained.has(stop.key) && !this.pending.has(stop.key),
    );
    if (missing >= 0) void this.fetchFrom(index + 1 + missing);
  }

  private fetchFrom(index: number): Promise<void> {
    const batch = this.stops
      .slice(index, index + BATCH)
      .filter((stop) => !this.explained.has(stop.key) && !this.pending.has(stop.key));
    const pageId = this.pageId;
    if (batch.length === 0 || !pageId) return Promise.resolve();
    const keys = batch.map((stop) => stop.key);
    const steps: { section_ids: string[] } | { form_steps: FormStep[] } =
      this.kind === 'form'
        ? {
            form_steps: batch.map((stop) => ({
              key: stop.key,
              heading: stop.heading,
              element_ids: stop.ids.slice(0, 20),
            })),
          }
        : { section_ids: keys };
    const request = this.deps.api
      .walkthrough(pageId, steps)
      .then((response) => {
        for (const step of response.steps) {
          if (step.say) this.explained.set(step.key, { say: step.say, risk_ids: step.risk_ids });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        for (const key of keys) this.pending.delete(key);
      });
    for (const key of keys) this.pending.set(key, request);
    return request;
  }

  private fallback(stop: TourStop): Explained {
    const snapshot = this.deps.snapshot();
    if (this.kind === 'form') return { say: formFallback(snapshot, stop.ids), risk_ids: [] };
    const text = snapshot?.sections.find((s) => s.id === stop.key)?.text ?? '';
    return { say: fallbackSay(text), risk_ids: [] };
  }
}
