/**
 * Proactive nudges. Iris speaks first only about risks, only
 * while it's listening, at most once a minute (20 s for a fee that appeared late), and never
 * twice about the same risk in one document. Everything else is a silent chip on the page.
 */
import type { ChipKind, ChipRequest, PageAdapter, PageEvent } from '../adapters/page-adapter';
import type { Nudge, PageType, PointerHint, RiskFlag, ScanResult, Severity } from './api';
import { COPY } from './copy';
import type { JourneyFinding } from './journey';

/** The automatic site check found a risky site. */
export interface TrustWarning {
  key: string;
  verdict: 'be_careful' | 'likely_unsafe';
  /** Spoken with a session: "Before you log in: …". */
  say: string;
  /** Shown without one. */
  notice: string;
  /** The password or payment field, for the ring and the chip. */
  element_id: string | null;
}
import type { VoiceSessionLike } from './session';
import type { IrisStore } from './store';

export const NUDGE_COOLDOWN_MS = 60_000;
export const LATE_PRICE_COOLDOWN_MS = 20_000;
export const LISTENING_WAIT_MS = 10_000;

export const STOP_SUGGESTING_RE =
  /\b(stop|no more|don't|do not)\b.*\b(suggest|suggesting|suggestions|nudg\w*)\b/i;

export const CHIP_LABELS = {
  explain: 'Explain',
  hover: 'Explain',
  cookie: 'Show reject option',
  terms: 'Read terms for me',
} as const;

/** Iris speaks first only on these pages; elsewhere risks get a chip. */
export const SPOKEN_PAGE_TYPES: ReadonlySet<PageType> = new Set([
  'checkout',
  'terms',
  'privacy',
  'offer',
]);

export const READ_TERMS_LINE = "Open the terms in a new tab and I'll go through them with you.";

/** Only one chip at a time: a more specific chip replaces a less specific one. */
const CHIP_PRIORITY: Record<ChipKind, number> = {
  explain: 5,
  cookie: 4,
  trust: 3,
  hover: 2,
  terms: 1,
  risks: 0,
};

export function risksChipLabel(count: number): string {
  return `⚠ ${String(count)} thing${count === 1 ? '' : 's'} to know`;
}

export function isStopSuggesting(text: string): boolean {
  return STOP_SUGGESTING_RE.test(text);
}

export function mayReplaceChip(current: ChipKind | null, next: ChipKind): boolean {
  return current === null || CHIP_PRIORITY[next] >= CHIP_PRIORITY[current];
}

// --- Chip policies (pure, shared with the extension's content script) ---

export function chipForPageEvent(event: PageEvent): ChipRequest | null {
  switch (event.type) {
    case 'hesitation':
      return { kind: 'explain', label: CHIP_LABELS.explain, element_id: event.element_id };
    case 'cookie_banner':
      return { kind: 'cookie', label: CHIP_LABELS.cookie, element_id: event.element_id };
    case 'legal_links_near_submit':
      return { kind: 'terms', label: CHIP_LABELS.terms, element_id: event.element_id };
    default:
      return null;
  }
}

interface RiskLike {
  severity: Severity;
  element_ids: string[];
  section_id?: string | null;
}

/** "⚠ N things to know" beside the first risky element; high and medium risks count. */
export function chipForRisks(risks: readonly RiskLike[]): ChipRequest | null {
  const counted = risks.filter((risk) => risk.severity !== 'info');
  const first = counted.find((risk) => risk.element_ids.length > 0 || risk.section_id);
  const elementId = first?.element_ids[0] ?? first?.section_id;
  if (!elementId) return null;
  return { kind: 'risks', label: risksChipLabel(counted.length), element_id: elementId };
}

function nudgeContext(nudge: Nudge, risks: readonly RiskFlag[]): string {
  const covered = risks.filter((risk) => nudge.risk_ids.includes(risk.id));
  const items = covered.map((risk) => {
    const ids = [...risk.element_ids, ...(risk.section_id ? [risk.section_id] : [])];
    return ids.length > 0 ? `${risk.title} (${ids.join(', ')})` : risk.title;
  });
  return `NUDGE CONTEXT: ${items.join('; ')}`;
}

export interface NudgeActions {
  /** Opens the Iris panel (the widget expands; the side panel is already open). */
  openIris(): void;
  /** "Explain": a field card for the element, spoken if a session is running. */
  explainField(elementId: string): Promise<void>;
  /** "⚠ N things to know": the risk list card. */
  showRisks(): void;
  /** "⚠ Check this site": the trust card. */
  showTrust(): void;
  /** "Explain" beside a clause or price the mouse rested on: ask_page about it, spoken. */
  explainHere(pointer: PointerHint): Promise<void>;
  /** The card that goes with a spoken nudge, if any. */
  cardForNudge(pageType: PageType | null, nudge: Nudge): Promise<void>;
}

export interface NudgeDeps {
  store: IrisStore;
  adapter: PageAdapter;
  session: () => VoiceSessionLike;
  actions: NudgeActions;
  /** A walkthrough is running: it reaches each risky part itself, so no risk nudge talks over it. */
  touring?: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class NudgeEngine {
  /** Nudged risk keys per document; the side panel switches documents with the tab. */
  private documents = new Map<string, Set<string>>();
  private document = 'page';
  private lastSpokenAt = Number.NEGATIVE_INFINITY;
  private chip: ChipKind | null = null;
  private speaking: string | null = null;
  private unsubscribe: (() => void) | null = null;
  /** Clauses and prices offered "Explain" in this document, and what each one was. */
  private hovered = new Map<string, PointerHint>();

  constructor(private readonly deps: NudgeDeps) {}

  start(): void {
    this.unsubscribe ??= this.deps.adapter.onPageEvent((event) => {
      this.onPageEvent(event);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private get nudged(): Set<string> {
    let keys = this.documents.get(this.document);
    if (!keys) {
      keys = new Set();
      this.documents.set(this.document, keys);
    }
    return keys;
  }

  /** Risk keys already nudged in this document, for the scan's exclude_keys. */
  excludeKeys(): string[] {
    return [...this.nudged];
  }

  /** The side panel follows another tab: its nudged risks are remembered separately. */
  useDocument(key: string): void {
    this.document = key;
    this.chip = null;
  }

  newDocument(): void {
    this.nudged.clear();
    this.hovered.clear();
    this.chip = null;
    this.deps.store.chips.value = [];
  }

  /** Nudges are on in settings and the user hasn't said "stop suggesting" this session. */
  get allowed(): boolean {
    const { store } = this.deps;
    return store.settings.value.nudges && !store.session.nudgesOff.value;
  }

  hideChips(): void {
    this.chip = null;
    this.deps.store.chips.value = [];
    void this.deps.adapter.hideChips();
  }

  /** A session just started: the page's risks can be spoken now (after the greeting). */
  onSessionReady(): void {
    const scan = this.deps.store.page.value?.scan;
    if (scan) this.onScan(scan);
  }

  onScan(scan: ScanResult): void {
    const { store, session } = this.deps;
    if (scan.status !== 'ready' || !this.allowed) return;
    const pageType = store.page.value?.page_type;
    if (!session().isRunning || !pageType || !SPOKEN_PAGE_TYPES.has(pageType)) {
      const chip = chipForRisks(scan.risks);
      if (chip) this.showChip(chip);
      return;
    }
    const nudge = scan.nudge;
    if (!nudge || nudge.risk_keys.every((key) => this.nudged.has(key))) return;
    if (this.deps.touring?.()) return;
    if (store.page.value?.page_id !== scan.page_id) return;
    void this.speak(nudge, scan);
  }

  onPageEvent(event: PageEvent): void {
    switch (event.type) {
      case 'chip-clicked':
        void this.onChipClicked(event.kind, event.element_id);
        return;
      case 'chip-hidden':
        this.chip = null;
        this.deps.store.chips.value = [];
        return;
      case 'page-changed':
        if (event.navigation) this.newDocument();
        void this.localRisksChip();
        return;
      case 'dwell':
        this.onDwell(event.element_id, {
          field_id: null,
          price_id: event.price_id,
          section_id: event.section_id,
        });
        return;
      default: {
        const chip = chipForPageEvent(event);
        if (chip) this.showChip(chip);
      }
    }
  }

  /**
   * The mouse rested on a clause or price: during a session, an "Explain"
   * chip beside it, once per element in a document.
   */
  private onDwell(elementId: string, hint: PointerHint): void {
    if (!this.deps.session().isRunning || !this.allowed || this.hovered.has(elementId)) return;
    if (!mayReplaceChip(this.chip, 'hover')) return;
    this.hovered.set(elementId, hint);
    this.showChip({ kind: 'hover', label: CHIP_LABELS.hover, element_id: elementId });
  }

  private showChip(chip: ChipRequest): void {
    if (!this.allowed || !mayReplaceChip(this.chip, chip.kind)) return;
    this.chip = chip.kind;
    this.deps.store.chips.value = [{ element_id: chip.element_id, label: chip.label }];
    void this.deps.adapter.showChip(chip);
  }

  /** Before any scan, and with no session: count the page's own client flags. */
  private async localRisksChip(): Promise<void> {
    const { store, session, adapter } = this.deps;
    if (session().isRunning || store.page.value?.scan?.status === 'ready' || !this.allowed) return;
    const snapshot = await adapter.getSnapshot();
    const chip = chipForRisks(snapshot.client_flags);
    if (chip) this.showChip(chip);
  }

  private sleep(ms: number): Promise<void> {
    return this.deps.sleep?.(ms) ?? new Promise((resolve) => setTimeout(resolve, ms));
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Waits (up to 10 s) until Iris is listening, so a nudge never talks over anyone. */
  private async waitForListening(): Promise<boolean> {
    const { store } = this.deps;
    for (let waited = 0; waited <= LISTENING_WAIT_MS; waited += 250) {
      if (store.session.state.value === 'listening') return true;
      await this.sleep(250);
    }
    return false;
  }

  /**
   * A figure on this page differs from an earlier page of the same site.
   * Spoken like a risk nudge; with no session, a notice in the panel instead.
   */
  onJourneyFinding(finding: JourneyFinding): void {
    const { store, session } = this.deps;
    if (!this.allowed || this.nudged.has(finding.key)) return;
    if (!session().isRunning) {
      this.nudged.add(finding.key);
      store.notice.value = { kind: 'info', message: finding.say };
      return;
    }
    const pageId = store.page.value?.page_id;
    if (!pageId) return;
    void this.sayFirst({
      keys: [finding.key],
      pageId,
      late: false,
      // The context rides in the instructions: the agent doesn't see conversation.message.
      instructions: `NUDGE CONTEXT: a figure differs from an earlier page (${finding.element_id})\n${COPY.sayExactly(finding.say)}`,
      highlightIds: [finding.element_id],
    });
  }

  /**
   * The automatic site check found a risky site: spoken like a nudge,
   * with a ring on the login or payment field; with no session, a notice and a chip.
   */
  onTrustWarning(warning: TrustWarning): void {
    const { store, session } = this.deps;
    if (!this.allowed || this.nudged.has(warning.key)) return;
    if (!session().isRunning) {
      this.nudged.add(warning.key);
      store.notice.value = { kind: 'info', message: warning.notice };
      if (warning.element_id) {
        this.showChip({ kind: 'trust', label: COPY.trustChip, element_id: warning.element_id });
      }
      return;
    }
    const pageId = store.page.value?.page_id;
    if (!pageId) return;
    void this.sayFirst({
      keys: [warning.key],
      pageId,
      late: false,
      instructions: `NUDGE CONTEXT: site check (${warning.verdict})\n${COPY.sayExactly(warning.say)}`,
      highlightIds: warning.element_id ? [warning.element_id] : [],
    });
  }

  private speak(nudge: Nudge, scan: ScanResult): Promise<void> {
    return this.sayFirst({
      keys: nudge.risk_keys,
      pageId: scan.page_id,
      late: nudge.risk_keys.some((k) => k.includes(':late_price:')),
      instructions: `${nudgeContext(nudge, scan.risks)}\n${COPY.sayExactly(nudge.say)}`,
      highlightIds: nudge.highlight_ids,
      card: nudge,
    });
  }

  /** Iris speaks first: after the cooldown, once it's listening, once per key and document. */
  private async sayFirst(line: {
    keys: string[];
    pageId: string;
    late: boolean;
    instructions: string;
    highlightIds: string[];
    card?: Nudge;
  }): Promise<void> {
    const key = line.keys.join(',');
    if (this.speaking === key) return;
    this.speaking = key;
    try {
      const { store, session, adapter, actions } = this.deps;
      const wait =
        this.lastSpokenAt + (line.late ? LATE_PRICE_COOLDOWN_MS : NUDGE_COOLDOWN_MS) - this.now();
      if (wait > 0) await this.sleep(wait);
      if (!(await this.waitForListening())) return;
      const current = session();
      const stillValid =
        this.allowed &&
        current.isRunning &&
        store.page.value?.page_id === line.pageId &&
        !line.keys.every((k) => this.nudged.has(k));
      if (!stillValid) return;
      for (const riskKey of line.keys) this.nudged.add(riskKey);
      this.lastSpokenAt = this.now();
      // Iris is about to speak by itself: a soft chime first, unless the user turned it off.
      if (store.settings.value.sound_cues) current.playCue();
      current.createReply(line.instructions);
      if (line.card) await actions.cardForNudge(store.page.value?.page_type ?? null, line.card);
      if (line.highlightIds.length > 0) {
        const shown = await adapter.highlight({ ids: line.highlightIds, level: 'risk' });
        store.highlightIds.value = shown.found;
      }
    } finally {
      this.speaking = null;
    }
  }

  private async onChipClicked(kind: ChipKind, elementId: string): Promise<void> {
    const { store, session, adapter, actions } = this.deps;
    this.chip = null;
    store.chips.value = [];
    switch (kind) {
      case 'explain':
        actions.openIris();
        await actions.explainField(elementId);
        return;
      case 'cookie': {
        const snapshot = await adapter.getSnapshot();
        const banner = snapshot.cookie_banner;
        const manage = snapshot.buttons.find((b) => b.id === banner?.manage_button_id);
        const target = manage?.id ?? banner?.id;
        if (!target) return;
        const note = manage
          ? `The reject option is inside '${manage.text}'.`
          : 'The reject option is inside the cookie settings.';
        const shown = await adapter.highlight({ ids: [target], note, level: 'normal' });
        store.highlightIds.value = shown.found;
        if (session().isRunning) session().createReply(COPY.sayExactly(note));
        return;
      }
      case 'terms':
        actions.openIris();
        if (session().isRunning) session().createReply(COPY.sayExactly(READ_TERMS_LINE));
        else store.notice.value = { kind: 'info', message: READ_TERMS_LINE };
        return;
      case 'risks':
        actions.openIris();
        actions.showRisks();
        return;
      case 'trust':
        actions.openIris();
        actions.showTrust();
        return;
      case 'hover': {
        const hint = this.hovered.get(elementId);
        if (!hint) return;
        actions.openIris();
        await actions.explainHere(hint);
        return;
      }
    }
  }
}
