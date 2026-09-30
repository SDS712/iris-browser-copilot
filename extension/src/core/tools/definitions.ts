/**
 * The ten agent tools: three run locally (the walkthrough fetches
 * its explanations), the rest call the backend. The client adds page_id (and the URL for check_site_trust) itself.
 */
import type {
  IrisApi,
  PageType,
  PointerHint,
  ToolEndpoint,
  ToolRequests,
  ToolResult,
} from '../api';
import { COPY } from '../copy';
import type { IrisStore } from '../store';
import type { Tour, TourAction, TourMode } from '../tour';
import type { PageAdapter } from '../../adapters/page-adapter';

export interface ToolDeps {
  api: Pick<IrisApi, 'tool'>;
  store: IrisStore;
  adapter: PageAdapter | null;
  /** The page's URL, for check_site_trust. */
  pageUrl: () => string;
  /** Earlier pages in this tab, newest first, for ask_page. */
  earlierPageIds?: () => string[];
  /** The guided walkthrough. */
  tour?: Tour | null;
}

/** A local tool's result JSON, or a backend ToolResult to render as a card. */
export type ToolOutput =
  { kind: 'local'; result: Record<string, unknown> } | { kind: 'backend'; result: ToolResult };

export interface ToolDefinition {
  /** Orb caption and loading-card text; null for tools that show no card. */
  caption(pageType: PageType | null): string | null;
  /** Backend tools need a registered page (all but site trust and web lookup). */
  needsPage: boolean;
  run(args: Record<string, unknown>, deps: ToolDeps, pageId: string | null): Promise<ToolOutput>;
}

/** A clear local error, sent to the agent as {"error": message}. */
export class ToolError extends Error {}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function requirePage(pageId: string | null): string {
  if (!pageId) throw new ToolError("I haven't been able to read this page yet.");
  return pageId;
}

/** A hint the interface passes itself (the "Explain" chip beside a clause), if well formed. */
function givenPointer(value: unknown): PointerHint | null {
  if (typeof value !== 'object' || value === null) return null;
  const hint = value as Record<string, unknown>;
  const id = (key: string) => (typeof hint[key] === 'string' ? hint[key] : null);
  const given = {
    field_id: id('field_id'),
    price_id: id('price_id'),
    section_id: id('section_id'),
  };
  return given.field_id || given.price_id || given.section_id ? given : null;
}

/** What "this" means on the page; a page that can't answer just gives no hint. */
async function pointerHint(deps: ToolDeps): Promise<PointerHint | null> {
  try {
    return (await deps.adapter?.pointerHint()) ?? null;
  } catch {
    return null;
  }
}

const readingOrTerms = (pageType: PageType | null) =>
  pageType === 'terms' || pageType === 'privacy' ? COPY.orb.checkingTerms : COPY.orb.readingPage;

async function backend<E extends ToolEndpoint>(
  deps: ToolDeps,
  endpoint: E,
  body: ToolRequests[E],
): Promise<ToolOutput> {
  return { kind: 'backend', result: await deps.api.tool(endpoint, body) };
}

export const TOOLS: Record<string, ToolDefinition> = {
  get_page_overview: {
    caption: () => null,
    needsPage: true,
    run: (_args, deps) => {
      const page = deps.store.page.value;
      if (!page) throw new ToolError("I haven't been able to read this page yet.");
      const scan = page.scan;
      return Promise.resolve({
        kind: 'local',
        result: {
          overview: page.summary_for_agent,
          risk_counts: scan?.counts ?? { high: 0, medium: 0, info: 0 },
          top_risks: (scan?.risks ?? []).slice(0, 3).map((risk) => risk.title),
        },
      });
    },
  },
  walk_through: {
    caption: () => null,
    needsPage: true,
    run: async (args, deps) => {
      if (!deps.tour) throw new ToolError("I can't walk through this page.");
      const actions: readonly TourAction[] = ['start', 'next', 'back', 'repeat', 'stop'];
      const action = actions.find((known) => known === args.action) ?? 'start';
      const modes: readonly TourMode[] = ['page', 'form'];
      const mode = modes.find((known) => known === args.mode);
      return { kind: 'local', result: await deps.tour.act(action, mode) };
    },
  },
  highlight_element: {
    caption: () => null,
    needsPage: false,
    run: async (args, deps) => {
      const ids = Array.isArray(args.element_ids)
        ? args.element_ids.filter((id): id is string => typeof id === 'string')
        : [];
      if (!deps.adapter) throw new ToolError("I can't point at things on this page.");
      const note = text(args.note)?.slice(0, 80) ?? null;
      const outcome = await deps.adapter.highlight({ ids, note, level: 'normal' });
      deps.store.highlightIds.value = outcome.found;
      return {
        kind: 'local',
        result: { ok: true, found: outcome.found, missing: outcome.missing },
      };
    },
  },
  explain_field: {
    caption: () => COPY.orb.readingPage,
    needsPage: true,
    run: async (args, deps, pageId) =>
      backend(deps, 'explain-field', {
        page_id: requirePage(pageId),
        field_id: text(args.field_id) ?? null,
        field_label: text(args.field_label) ?? null,
        pointer: await pointerHint(deps),
      }),
  },
  ask_page: {
    caption: readingOrTerms,
    needsPage: true,
    run: async (args, deps, pageId) =>
      backend(deps, 'ask-page', {
        page_id: requirePage(pageId),
        question: text(args.question) ?? '',
        pointer: givenPointer(args.pointer) ?? (await pointerHint(deps)),
        earlier_page_ids: deps.earlierPageIds?.() ?? [],
      }),
  },
  summarize_page: {
    caption: () => COPY.orb.readingPage,
    needsPage: true,
    run: (args, deps, pageId) =>
      backend(deps, 'summarize', {
        page_id: requirePage(pageId),
        style: args.style === 'detailed' ? 'detailed' : 'quick',
        focus: text(args.focus) ?? null,
      }),
  },
  scan_page_risks: {
    caption: readingOrTerms,
    needsPage: true,
    run: (args, deps, pageId) => {
      const kinds = ['terms', 'privacy', 'checkout', 'offer', 'general'] as const;
      const kind = kinds.find((k) => k === args.kind) ?? null;
      return backend(deps, 'scan', { page_id: requirePage(pageId), kind });
    },
  },
  check_site_trust: {
    caption: () => COPY.orb.checkingSite,
    needsPage: false,
    run: (_args, deps) => backend(deps, 'site-trust', { url: deps.pageUrl() }),
  },
  web_lookup: {
    caption: () => COPY.orb.lookingUp,
    needsPage: false,
    run: (args, deps, pageId) =>
      backend(deps, 'web-lookup', { query: text(args.query) ?? '', page_id: pageId }),
  },
  calculate_loan_cost: {
    caption: () => COPY.orb.doingMaths,
    needsPage: false,
    run: (args, deps, pageId) => {
      const bases = ['flat_monthly', 'flat_annual', 'reducing_annual'] as const;
      return backend(deps, 'loan-cost', {
        page_id: pageId,
        principal_inr: num(args.principal_inr) ?? null,
        rate_percent: num(args.rate_percent) ?? null,
        rate_basis: bases.find((b) => b === args.rate_basis) ?? null,
        tenure_months: num(args.tenure_months) ?? null,
        processing_fee_inr: num(args.processing_fee_inr) ?? null,
        processing_fee_percent: num(args.processing_fee_percent) ?? null,
        gst_percent_on_fee: num(args.gst_percent_on_fee) ?? null,
        fees_deducted_upfront: true,
      });
    },
  },
};
