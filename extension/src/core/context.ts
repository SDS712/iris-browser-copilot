/**
 * The current page: register each new snapshot, keep the tab's journey,
 * send the page context into the conversation whenever it changes, and poll the background
 * scan while it's pending.
 */
import type { PageAdapter, PageEvent } from '../adapters/page-adapter';
import {
  IrisApiError,
  type CreatePageResponse,
  type IrisApi,
  type PageSnapshot,
  type PageType,
  type ScanResult,
} from './api';
import { compareWithEarlier, entryFor, type JourneyFinding, type JourneyTrail } from './journey';
import type { VoiceSessionLike } from './session';
import type { IrisStore } from './store';

export const SCAN_POLL_MS = 1_500;
// Longer than the backend's 45 s deep-scan limit, so a slow scan on a long page still lands.
export const SCAN_POLL_FOR_MS = 60_000;

export interface PageContextDeps {
  api: Pick<IrisApi, 'registerPage' | 'scan'>;
  store: IrisStore;
  adapter: PageAdapter;
  session: () => VoiceSessionLike;
  /** Risk keys already nudged in this document. */
  excludeKeys?: () => readonly string[];
  /** Every scan result, for the nudge engine. */
  onScan?: (scan: ScanResult) => void;
  /** A new document (navigation): cards and highlights from the old one no longer apply. */
  onNewDocument?: () => void;
  /** The tab's journey: earlier pages for the agent and ask_page, and figures to compare. */
  journey?: JourneyTrail;
  /** A figure on this page differs from an earlier page of the same site. */
  onJourneyFinding?: (finding: JourneyFinding) => void;
  /** A new document was registered (not a revision): the site-trust check. */
  onNewDocumentRegistered?: (snapshot: PageSnapshot, response: CreatePageResponse) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** The current page's summary, then the journey block (earlier pages and their summary). */
export function pageContextMessage(summary: string, journey = ''): string {
  const current = `PAGE CONTEXT (do not read aloud):\n${summary}`;
  return journey ? `${current}\n\n${journey}` : current;
}

export class PageContext {
  /** The snapshot the page last gave us (IrisDebug.lastSnapshot()). */
  lastSnapshot: PageSnapshot | null = null;
  private registeredKey: string | null = null;
  private generation = 0;
  /** The page context last sent into this session; it's sent again only when it changes. */
  private sentMessage: string | null = null;
  /** The next registration is a new document, not a revision of the current one. */
  private newDocument = true;
  private unsubscribe: (() => void) | null = null;
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;

  constructor(private readonly deps: PageContextDeps) {}

  /** Starts following the page: registers it now and again whenever it changes. */
  start(): Promise<void> {
    this.unsubscribe ??= this.deps.adapter.onPageEvent((event) => {
      this.onPageEvent(event);
    });
    return this.refresh();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.generation += 1;
  }

  /** Registers the latest snapshot if it's new. Calls made while one runs are coalesced. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    const run = async () => {
      do {
        this.refreshAgain = false;
        await this.registerLatest();
      } while (this.askedAgain());
    };
    this.refreshing = run().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** Whether refresh() was called again while the last registration ran. */
  private askedAgain(): boolean {
    return this.refreshAgain;
  }

  /**
   * After session.ready, and whenever the page or the journey changes during a session
   *. Nothing is sent when the text is the same as last time.
   */
  sendPageContext(): void {
    const page = this.deps.store.page.value;
    const session = this.deps.session();
    if (!page || !session.isRunning) return;
    const message = pageContextMessage(
      page.summary_for_agent,
      this.deps.journey?.contextBlock() ?? '',
    );
    if (message === this.sentMessage) return;
    this.sentMessage = message;
    session.setPageContext(message);
  }

  /** A new session needs the page context again. */
  onSessionEnded(): void {
    this.sentMessage = null;
  }

  /** Which snapshot the current page_id belongs to (the side panel keeps one per tab). */
  get snapshotKey(): string | null {
    return this.registeredKey;
  }

  set snapshotKey(key: string | null) {
    this.registeredKey = key;
  }

  /** A new document in the same tab: forget the old page and its cards. */
  forget(): void {
    this.registeredKey = null;
    this.newDocument = true;
    this.lastSnapshot = null;
    this.deps.store.page.value = null;
    this.deps.onNewDocument?.();
  }

  /** The backend forgot the page (expired after 30 minutes): register it again. */
  async reregister(): Promise<string | null> {
    this.registeredKey = null;
    await this.refresh();
    return this.deps.store.page.value?.page_id ?? null;
  }

  private onPageEvent(event: PageEvent): void {
    if (event.type !== 'page-changed') return;
    if (event.navigation) {
      this.registeredKey = null;
      this.newDocument = true;
      this.deps.onNewDocument?.();
    }
    void this.refresh();
  }

  private async registerLatest(): Promise<void> {
    const { store, adapter, api } = this.deps;
    const generation = this.generation;
    if (!store.page.value) store.pageStatus.value = 'reading';
    let snapshot;
    try {
      snapshot = await adapter.getSnapshot();
    } catch {
      if (generation === this.generation) store.pageStatus.value = 'unsupported';
      return;
    }
    this.lastSnapshot = snapshot;
    const key = `${snapshot.url}|${snapshot.captured_at}`;
    if (key === this.registeredKey && store.page.value) return;
    let response;
    try {
      response = await api.registerPage(snapshot);
    } catch (error) {
      if (generation !== this.generation) return;
      if (!(error instanceof IrisApiError) || error.status === 0 || error.status >= 500) {
        store.pageStatus.value = 'unreachable';
      }
      return;
    }
    if (generation !== this.generation) return;
    this.registeredKey = key;
    store.pageStatus.value = 'ready';
    store.page.value = {
      page_id: response.page_id,
      page_type: response.page_type,
      url: snapshot.url,
      summary_for_agent: response.summary_for_agent,
      truncated: snapshot.truncated,
      scan: null,
    };
    const fresh = this.newDocument;
    this.followJourney(response.page_id, response.page_type, snapshot);
    if (fresh) this.deps.onNewDocumentRegistered?.(snapshot, response);
    this.sendPageContext();
    void this.pollScan(response.page_id, generation);
  }

  /** The page joins the tab's journey; a figure that changed since an earlier page is news. */
  private followJourney(pageId: string, pageType: PageType, snapshot: PageSnapshot): void {
    const journey = this.deps.journey;
    if (!journey) return;
    const now = this.deps.now ?? Date.now;
    journey.arrive(entryFor(pageId, pageType, snapshot, now()), !this.newDocument);
    this.newDocument = false;
    const current = journey.current;
    const finding = current ? compareWithEarlier(current, journey.earlier()) : null;
    if (finding) this.deps.onJourneyFinding?.(finding);
  }

  private async pollScan(pageId: string, generation: number): Promise<void> {
    const { api, store } = this.deps;
    const now = this.deps.now ?? Date.now;
    const sleep =
      this.deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const deadline = now() + SCAN_POLL_FOR_MS;
    for (;;) {
      let scan: ScanResult;
      try {
        scan = await api.scan(pageId, this.deps.excludeKeys?.() ?? []);
      } catch {
        return;
      }
      const page = store.page.value;
      // Stop when Iris stops following the page or a newer page_id replaced this one.
      if (generation !== this.generation || page?.page_id !== pageId) return;
      store.page.value = { ...page, scan };
      if (scan.status === 'ready') {
        const risks = scan.risks.filter((risk) => risk.severity !== 'info');
        this.deps.journey?.noteRisks(
          pageId,
          risks.slice(0, 2).map((risk) => risk.title),
        );
      }
      this.deps.onScan?.(scan);
      if (scan.status !== 'pending' || now() >= deadline) return;
      await sleep(SCAN_POLL_MS);
    }
  }
}
