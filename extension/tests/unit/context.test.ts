import { describe, expect, it, vi } from 'vitest';
import { IrisApiError } from '../../src/core/api';
import { PageContext, pageContextMessage, SCAN_POLL_MS } from '../../src/core/context';
import { JourneyTrail, memoryStorage } from '../../src/core/journey';
import { createStore } from '../../src/core/store';
import { fakeAdapter, fakeApi, fakeSession, scanResult, snapshot } from './fakes';

function setup(options: { running?: boolean; scans?: ReturnType<typeof scanResult>[] } = {}) {
  const store = createStore();
  const page = fakeAdapter();
  const scans = options.scans ?? [scanResult('ready')];
  const api = fakeApi({
    scan: vi.fn((pageId: string) =>
      Promise.resolve({ ...(scans.shift() ?? scanResult('ready')), page_id: pageId }),
    ),
  });
  const session = fakeSession(options.running ?? false);
  const sleep = vi.fn(() => Promise.resolve());
  const onNewDocument = vi.fn();
  const context = new PageContext({
    api,
    store,
    adapter: page.adapter,
    session: () => session,
    sleep,
    onNewDocument,
  });
  return { store, page, api, session, sleep, context, onNewDocument };
}

describe('page context', () => {
  it('registers the page and polls the scan every 1.5 s while it is pending', async () => {
    const { store, api, sleep, context } = setup({
      scans: [scanResult('pending'), scanResult('pending'), scanResult('ready')],
    });
    await context.start();
    await vi.waitFor(() => {
      expect(store.page.value?.scan?.status).toBe('ready');
    });
    expect(store.page.value?.page_id).toBe('pg_1');
    expect(store.pageStatus.value).toBe('ready');
    expect(api.scan).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(SCAN_POLL_MS);
  });

  it('keeps polling past the backend’s 45 s deep-scan limit, then stops', async () => {
    let clock = 0;
    const pending = (count: number) => Array.from({ length: count }, () => scanResult('pending'));
    const run = async (scans: ReturnType<typeof scanResult>[]) => {
      const store = createStore();
      const api = fakeApi({
        scan: vi.fn((pageId: string) =>
          Promise.resolve({ ...(scans.shift() ?? scanResult('pending')), page_id: pageId }),
        ),
      });
      const context = new PageContext({
        api,
        store,
        adapter: fakeAdapter().adapter,
        session: () => fakeSession(false),
        now: () => clock,
        sleep: (ms: number) => {
          clock += ms;
          return Promise.resolve();
        },
      });
      clock = 0;
      await context.start();
      return { store, api };
    };

    // A scan that is ready 46 s in (31 polls) still reaches the strip.
    const slow = await run([...pending(31), scanResult('ready')]);
    await vi.waitFor(() => {
      expect(slow.store.page.value?.scan?.status).toBe('ready');
    });

    // A scan that never finishes: the last poll is at 60 s.
    const stuck = await run([]);
    await vi.waitFor(() => {
      expect(stuck.api.scan).toHaveBeenCalledTimes(41);
    });
    expect(clock).toBe(60_000);
  });

  it('does not register the same snapshot twice', async () => {
    const { api, context } = setup();
    await context.start();
    await context.refresh();
    expect(api.registerPage).toHaveBeenCalledTimes(1);
  });

  it('sends the page context when its text changes during a session, and again next session', async () => {
    const { session, context, page } = setup({ running: true });
    await context.start();
    context.sendPageContext();
    expect(session.setPageContext).toHaveBeenCalledTimes(1);
    expect(session.setPageContext).toHaveBeenCalledWith(pageContextMessage('PAGE: Terms'));
    // A new page_id with the same summary changes nothing the agent sees.
    page.setSnapshot(snapshot({ revision: 2, captured_at: '2026-09-27T10:00:05.000Z' }));
    page.emit({
      type: 'page-changed',
      revision: 2,
      captured_at: '2026-09-27T10:00:05.000Z',
      navigation: false,
    });
    await vi.waitFor(() => {
      expect(context.lastSnapshot?.revision).toBe(2);
    });
    expect(session.setPageContext).toHaveBeenCalledTimes(1);
    page.setSnapshot(
      snapshot({ revision: 3, title: 'Terms v2', captured_at: '2026-09-27T10:00:09.000Z' }),
    );
    page.emit({
      type: 'page-changed',
      revision: 3,
      captured_at: '2026-09-27T10:00:09.000Z',
      navigation: false,
    });
    await vi.waitFor(() => {
      expect(session.setPageContext).toHaveBeenCalledTimes(2);
    });
    context.onSessionEnded();
    context.sendPageContext();
    expect(session.setPageContext).toHaveBeenCalledTimes(3);
  });

  it('never sends the page context without a session', async () => {
    const { session, context } = setup({ running: false });
    await context.start();
    expect(session.setPageContext).not.toHaveBeenCalled();
  });

  it('forgets the old document on navigation', async () => {
    const { store, context, page, onNewDocument } = setup();
    await context.start();
    page.setSnapshot(
      snapshot({ url: 'https://example.com/privacy', captured_at: '2026-09-27T10:01:00.000Z' }),
    );
    page.emit({
      type: 'page-changed',
      revision: 1,
      captured_at: '2026-09-27T10:01:00.000Z',
      navigation: true,
    });
    await vi.waitFor(() => {
      expect(store.page.value?.url).toBe('https://example.com/privacy');
    });
    expect(onNewDocument).toHaveBeenCalledTimes(1);
  });

  it('shows "unreachable" when the backend cannot be reached', async () => {
    const store = createStore();
    const api = fakeApi({
      registerPage: vi.fn(() => Promise.reject(new IrisApiError('network_error', 'x', 'y', 0))),
    });
    const context = new PageContext({
      api,
      store,
      adapter: fakeAdapter().adapter,
      session: () => fakeSession(),
    });
    await context.start();
    expect(store.pageStatus.value).toBe('unreachable');
  });
});

describe('the journey in the page context', () => {
  function withJourney() {
    const store = createStore();
    const page = fakeAdapter(
      snapshot({
        url: 'https://shop.example/offer',
        title: 'Offer',
        page_type_hint: 'offer',
        prices: [
          {
            id: 'i-2',
            label: 'Processing fee',
            amount_text: '₹999',
            amount_inr: 999,
            first_seen_revision: 1,
          },
        ],
      }),
    );
    const session = fakeSession(true);
    let clock = 0;
    const journey = new JourneyTrail({
      storage: memoryStorage(),
      summarise: () => Promise.resolve(''),
      now: () => clock,
    });
    const onJourneyFinding = vi.fn();
    const context = new PageContext({
      api: fakeApi(),
      store,
      adapter: page.adapter,
      session: () => session,
      sleep: () => Promise.resolve(),
      journey,
      onJourneyFinding,
      now: () => clock,
    });
    return {
      page,
      session,
      journey,
      context,
      onJourneyFinding,
      at: (ms: number) => {
        clock = ms;
      },
    };
  }

  it('adds each new page, tells the agent about earlier ones, and spots a changed fee', async () => {
    const { page, session, journey, context, onJourneyFinding, at } = withJourney();
    await context.start();
    expect(journey.entries.map((e) => e.url)).toEqual(['https://shop.example/offer']);
    at(10_000);
    page.setSnapshot(
      snapshot({
        url: 'https://shop.example/checkout',
        title: 'Checkout',
        page_type_hint: 'checkout',
        captured_at: '2026-09-27T10:05:00.000Z',
        prices: [
          {
            id: 'i-9',
            label: 'Processing fee',
            amount_text: '₹1,416',
            amount_inr: 1416,
            first_seen_revision: 1,
          },
        ],
      }),
    );
    page.emit({
      type: 'page-changed',
      revision: 1,
      captured_at: '2026-09-27T10:05:00.000Z',
      navigation: true,
    });
    await vi.waitFor(() => {
      expect(journey.entries).toHaveLength(2);
    });
    expect(journey.earlierPageIds()).toEqual(['pg_1']);
    expect(onJourneyFinding).toHaveBeenCalledWith(expect.objectContaining({ element_id: 'i-9' }));
    expect(session.setPageContext).toHaveBeenLastCalledWith(
      pageContextMessage('PAGE: Checkout', journey.contextBlock()),
    );
    expect(journey.contextBlock()).toContain('Offer (offer, shop.example): Processing fee ₹999');
  });

  it('a revision of the same page replaces its entry', async () => {
    const { page, journey, context, at } = withJourney();
    await context.start();
    at(1_000);
    page.setSnapshot(
      snapshot({ url: 'https://shop.example/offer', revision: 2, captured_at: 'later' }),
    );
    page.emit({ type: 'page-changed', revision: 2, captured_at: 'later', navigation: false });
    await vi.waitFor(() => {
      expect(journey.current?.page_id).toBe('pg_2');
    });
    expect(journey.entries).toHaveLength(1);
  });
});
