/** Small fakes for core tests: a page adapter, an API and a session that records calls. */
import { vi, type Mock } from 'vitest';
import type { ChipRequest, PageAdapter, PageEvent } from '../../src/adapters/page-adapter';
import type {
  CreatePageResponse,
  IrisApi,
  PageSnapshot,
  PointerHint,
  ScanResult,
} from '../../src/core/api';
import type { VoiceSessionLike } from '../../src/core/session';

export function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    contract_version: 1,
    url: 'https://example.com/terms',
    title: 'Terms',
    lang: 'en',
    page_type_hint: 'terms',
    revision: 1,
    captured_at: '2026-09-27T10:00:00.000Z',
    truncated: false,
    fields: [],
    checkboxes: [],
    buttons: [],
    prices: [],
    sections: [],
    legal_links: [],
    cookie_banner: null,
    client_flags: [],
    ...overrides,
  };
}

export function fakeAdapter(first: PageSnapshot = snapshot()) {
  let current = first;
  const listeners = new Set<(event: PageEvent) => void>();
  const adapter = {
    getSnapshot: vi.fn(() => Promise.resolve(current)),
    highlight: vi.fn((request: { ids: string[] }) =>
      Promise.resolve({ found: request.ids, missing: [] as string[] }),
    ),
    clearHighlights: vi.fn(() => Promise.resolve()),
    showChip: vi.fn((_request: ChipRequest) => Promise.resolve()),
    hideChips: vi.fn(() => Promise.resolve()),
    describeElement: vi.fn(() => Promise.resolve(null)),
    overlayRects: vi.fn(() => Promise.resolve([])),
    pointerHint: vi.fn(() => Promise.resolve<PointerHint | null>(null)),
    onPageEvent: (callback: (event: PageEvent) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  } satisfies PageAdapter;
  return {
    adapter,
    setSnapshot(next: PageSnapshot) {
      current = next;
    },
    emit(event: PageEvent) {
      for (const listener of listeners) listener(event);
    },
  };
}

export function scanResult(status: ScanResult['status'], pageId = 'pg_1'): ScanResult {
  return {
    contract_version: 1,
    page_id: pageId,
    status,
    kind: 'terms',
    risks: [],
    counts: { high: 0, medium: 0, info: 0 },
    nudge: null,
  };
}

/** Every API method as a mock (properties, so tests can pass them to expect()). */
export type FakeApi = { [K in keyof IrisApi]: Mock<IrisApi[K]> };

export function fakeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  let pages = 0;
  return {
    agentConfig: vi.fn<IrisApi['agentConfig']>(),
    voiceToken: vi.fn<IrisApi['voiceToken']>(),
    registerPage: vi.fn((snap: PageSnapshot) => {
      pages += 1;
      const response: CreatePageResponse = {
        contract_version: 1,
        page_id: `pg_${String(pages)}`,
        page_type: snap.page_type_hint,
        summary_for_agent: `PAGE: ${snap.title}`,
        scan: { status: 'pending', kind: 'terms' },
        site_signals: [],
      };
      return Promise.resolve(response);
    }),
    scan: vi.fn((pageId: string) => Promise.resolve(scanResult('ready', pageId))),
    tool: vi.fn<IrisApi['tool']>(),
    walkthrough: vi.fn<IrisApi['walkthrough']>((_pageId, steps) =>
      Promise.resolve({
        contract_version: 1,
        steps: ('section_ids' in steps
          ? steps.section_ids
          : steps.form_steps.map((s) => s.key)
        ).map((key) => ({ key, heading: null, say: `About ${key}.`, risk_ids: [] })),
      }),
    ),
    journeySummary: vi.fn<IrisApi['journeySummary']>(() =>
      Promise.resolve({ contract_version: 1, summary: 'Earlier pages.' }),
    ),
    ...overrides,
  };
}

export function fakeSession(running = true) {
  return {
    isRunning: running,
    start: vi.fn(() => Promise.resolve()),
    end: vi.fn(() => Promise.resolve()),
    endNow: vi.fn(),
    handOver: vi.fn(() => null),
    sendUserText: vi.fn(),
    setPageContext: vi.fn(),
    createReply: vi.fn(),
    playCue: vi.fn(),
    submitToolResult: vi.fn(),
    setMuted: vi.fn(),
    resumeAudio: vi.fn(() => Promise.resolve()),
    stopAudio: vi.fn(),
    retryMicrophone: vi.fn(() => Promise.resolve()),
  } satisfies VoiceSessionLike;
}
