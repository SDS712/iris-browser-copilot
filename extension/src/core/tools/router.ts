/**
 * Runs tool calls: show the caption and a loading card, call the
 * handler, render the card and highlights the moment the result arrives, then hand the
 * agent's result JSON to the session, which sends it when AssemblyAI's pattern allows.
 */
import { IrisApiError, type Card, type ToolResult } from '../api';
import { COPY } from '../copy';
import type { PageContext } from '../context';
import type { ToolCallEvent } from '../protocol';
import { addLoadingCard, removeCard, settleCard } from '../store';
import { TOOLS, ToolError, type ToolDeps } from './definitions';

export interface RouterDeps extends ToolDeps {
  context: PageContext | null;
  submit(callId: string, result: unknown, isError: boolean): void;
  /** Any tool use keeps the tab's journey alive (its 30 idle minutes start again). */
  onActivity?: () => void;
}

export interface ToolOutcome {
  /** The JSON the agent gets. */
  agentResult: Record<string, unknown>;
  isError: boolean;
  /** The backend result, for backend tools that succeeded. */
  toolResult: ToolResult | null;
}

const CARD_NAMES: Record<Card['kind'], string> = {
  answer: 'answer card',
  field: 'field card',
  risk_list: 'risk list card',
  summary: 'summary card',
  web_answer: 'web answer card',
  true_cost: 'true cost card',
  trust: 'trust card',
};

/** "answer card, 1 highlight": what's on screen, so the agent can refer to it. */
export function shownText(result: ToolResult, highlights: number): string {
  const parts = [result.card ? CARD_NAMES[result.card.kind] : 'no card'];
  if (highlights > 0) parts.push(`${String(highlights)} highlight${highlights === 1 ? '' : 's'}`);
  return parts.join(', ');
}

function errorMessage(error: unknown): string {
  if (error instanceof IrisApiError) return error.agentMessage || error.message;
  if (error instanceof ToolError) return error.message;
  return COPY.agent.backendUnreachable;
}

export class ToolRouter {
  constructor(private readonly deps: RouterDeps) {}

  /** An agent's tool.call: run it and queue the result. */
  async handle(call: ToolCallEvent): Promise<void> {
    const outcome = await this.run(call.name, call.arguments);
    this.deps.submit(call.call_id, outcome.agentResult, outcome.isError);
  }

  /** Runs a tool the same way for the agent, the interface and IrisDebug.runTool. */
  async run(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    const definition = TOOLS[name];
    if (!definition) {
      return {
        agentResult: { error: `There's no tool called ${name}.` },
        isError: true,
        toolResult: null,
      };
    }
    const { store, adapter, context } = this.deps;
    this.deps.onActivity?.();
    const caption = definition.caption(store.page.value?.page_type ?? null);
    const cardId = caption ? addLoadingCard(store, name, caption) : null;
    if (caption) store.session.toolCaption.value = caption;
    try {
      let pageId = store.page.value?.page_id ?? null;
      if (definition.needsPage && !pageId && context) {
        await context.refresh();
        pageId = store.page.value?.page_id ?? null;
      }
      let output;
      try {
        output = await definition.run(args, this.deps, pageId);
      } catch (error) {
        if (!(error instanceof IrisApiError) || error.code !== 'page_not_found' || !context) {
          throw error;
        }
        // The page expired on the backend (30 minutes): register it again and retry once.
        pageId = await context.reregister();
        output = await definition.run(args, this.deps, pageId);
      }
      if (output.kind === 'local') {
        if (cardId) removeCard(store, cardId);
        return { agentResult: output.result, isError: false, toolResult: null };
      }
      const result = output.result;
      if (cardId) settleCard(store, cardId, result);
      let highlights = 0;
      if (adapter && result.highlight_ids.length > 0) {
        const level = result.card?.kind === 'risk_list' ? 'risk' : 'normal';
        const shown = await adapter.highlight({
          ids: result.highlight_ids,
          quote_text: result.quote_text,
          level,
        });
        store.highlightIds.value = shown.found;
        highlights = shown.found.length;
      }
      return {
        agentResult: {
          say: result.say,
          notes: result.agent_notes,
          not_found: result.not_found,
          shown: shownText(result, highlights),
        },
        isError: false,
        toolResult: result,
      };
    } catch (error) {
      if (cardId) removeCard(store, cardId);
      return { agentResult: { error: errorMessage(error) }, isError: true, toolResult: null };
    }
  }
}
