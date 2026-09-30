/** Helpers for driving the Iris widget through window.IrisDebug. */
import type { Page } from '@playwright/test';

export const FLAGS = '?iris_mock_voice=1&iris_debug=1';

interface Flag {
  rule: string;
  category: string;
  severity: string;
  element_ids: string[];
  params: Record<string, number | string>;
  amount_inr: number | null;
}

interface Snapshot {
  page_type_hint: string;
  revision: number;
  fields: {
    id: string;
    label: string;
    sensitive: boolean;
    filled: boolean;
    placeholder: string | null;
  }[];
  checkboxes: { id: string; label: string; prechecked: boolean }[];
  prices: { id: string; label: string | null; amount_text: string; first_seen_revision: number }[];
  cookie_banner: { manage_button_id: string | null; reject_visible: boolean } | null;
  client_flags: Flag[];
}

interface Card {
  kind: string;
  source: string;
  topic: string;
  figure_text?: string;
  risks?: { category: string; title: string }[];
}

interface DebugState {
  session_state: string;
  page_id: string | null;
  cards: Card[];
  highlight_ids: string[];
  chips: { element_id: string; label: string }[];
  spoken: string[];
}

interface ToolResult {
  say: string;
  card: Card | null;
  not_found: boolean;
  quote_text: string | null;
  highlight_ids: string[];
}

declare global {
  interface Window {
    IrisDebug?: {
      getState(): DebugState;
      runTool(
        name: string,
        args?: Record<string, unknown>,
      ): Promise<ToolResult | { error: unknown }>;
      refreshSnapshot(): Promise<{ page_id: string; page_type: string }>;
      lastSnapshot(): Snapshot | null;
      overlayRects(): {
        kind: string;
        rect: { x: number; y: number; width: number; height: number };
      }[];
      startSession(): Promise<void>;
      endSession(): Promise<void>;
    };
    Iris?: { open(): void; close(): void; isOpen(): boolean };
  }
}

export async function openDemo(page: Page, path: string): Promise<void> {
  await page.goto(`${path}${FLAGS}`);
  await page.waitForFunction(() => window.IrisDebug !== undefined);
}

export function iris(page: Page) {
  return {
    refresh: () => page.evaluate(() => window.IrisDebug?.refreshSnapshot()),
    snapshot: () => page.evaluate(() => window.IrisDebug?.lastSnapshot() ?? null),
    state: () => page.evaluate(() => window.IrisDebug?.getState()),
    runTool: (name: string, args: Record<string, unknown> = {}) =>
      page.evaluate(([n, a]) => window.IrisDebug?.runTool(n, a), [name, args] as const),
    kinds: () => page.evaluate(() => (window.IrisDebug?.overlayRects() ?? []).map((r) => r.kind)),
    startSession: () => page.evaluate(() => window.IrisDebug?.startSession()),
  };
}

/** Rules in the latest snapshot's client flags. */
export async function rules(page: Page): Promise<string[]> {
  const snapshot = await iris(page).snapshot();
  return (snapshot?.client_flags ?? []).map((flag) => flag.rule).sort();
}
