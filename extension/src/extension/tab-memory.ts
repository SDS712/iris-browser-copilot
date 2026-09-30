/**
 * The side panel follows the active tab: each tab keeps its own page and
 * cards, and switching back to a tab shows them again without registering it twice.
 */
import type { PageContext } from '../core/context';
import type { JourneyState, JourneyStorage } from '../core/journey';
import type { CardEntry, CurrentPage, IrisStore, PageStatus } from '../core/store';

interface TabState {
  page: CurrentPage | null;
  pageStatus: PageStatus;
  cards: CardEntry[];
  expandedCard: string | null;
  snapshotKey: string | null;
}

export class TabMemory {
  private tabs = new Map<number, TabState>();

  constructor(
    private readonly store: IrisStore,
    private readonly context: PageContext,
  ) {}

  save(tabId: number): void {
    const { store } = this;
    this.tabs.set(tabId, {
      page: store.page.value,
      pageStatus: store.pageStatus.value,
      cards: store.cards.value,
      expandedCard: store.expandedCard.value,
      snapshotKey: this.context.snapshotKey,
    });
  }

  restore(tabId: number): void {
    const { store } = this;
    const state = this.tabs.get(tabId);
    store.page.value = state?.page ?? null;
    store.pageStatus.value = state?.pageStatus ?? 'none';
    store.cards.value = state?.cards ?? [];
    store.expandedCard.value = state?.expandedCard ?? null;
    store.highlightIds.value = [];
    store.chips.value = [];
    this.context.snapshotKey = state?.snapshotKey ?? null;
  }

  forget(tabId: number): void {
    this.tabs.delete(tabId);
  }
}

/** Each tab's journey, in memory while the side panel is open. */
export class TabJourneys {
  private states = new Map<number, JourneyState>();

  constructor(private readonly tab: () => number | null) {}

  readonly storage: JourneyStorage = {
    load: () => {
      const tab = this.tab();
      return tab === null ? null : (this.states.get(tab) ?? null);
    },
    save: (state) => {
      const tab = this.tab();
      if (tab === null) return;
      if (state) this.states.set(tab, state);
      else this.states.delete(tab);
    },
  };

  forget(tabId: number): void {
    this.states.delete(tabId);
  }
}
