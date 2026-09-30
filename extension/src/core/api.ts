/** Typed backend client. Wire types come from the generated api-types.ts. */
import type { components, paths } from './api-types';
import { COPY } from './copy';
import type { VoiceChoice } from './settings';

type Schemas = components['schemas'];
export type AgentConfig = Schemas['AgentConfigResponse'];
export type AgentSession = Schemas['AgentSession'];
export type VoiceToken = Schemas['VoiceTokenResponse'];
export type PageSnapshot = Schemas['PageSnapshot'];
export type PageType = PageSnapshot['page_type_hint'];
export type RiskCategory = Schemas['RiskFlag']['category'];
export type Severity = Schemas['RiskFlag']['severity'];
export type CardSource = Card['source'];
export type CreatePageResponse = Schemas['CreatePageResponse'];
export type ScanResult = Schemas['ScanResult'];
export type Nudge = Schemas['Nudge'];
export type ToolResult = Schemas['ToolResult'];
export type Card = NonNullable<ToolResult['card']>;
export type RiskFlag = Schemas['RiskFlag'];
export type Source = Schemas['Source'];
/** What the user points at on the page: element IDs only. */
export type PointerHint = Schemas['PointerHint'];
export type JourneySummary = Schemas['JourneySummaryResponse'];
export type Walkthrough = Schemas['WalkthroughResponse'];
export type FormStep = Schemas['FormStep'];

type JsonBody<P extends keyof paths> = paths[P] extends {
  post: { requestBody: { content: { 'application/json': infer B } } };
}
  ? B
  : never;

/** Tool endpoints under /api/tools, with their request bodies. */
export interface ToolRequests {
  'explain-field': JsonBody<'/api/tools/explain-field'>;
  'ask-page': JsonBody<'/api/tools/ask-page'>;
  summarize: JsonBody<'/api/tools/summarize'>;
  scan: JsonBody<'/api/tools/scan'>;
  'site-trust': JsonBody<'/api/tools/site-trust'>;
  'web-lookup': JsonBody<'/api/tools/web-lookup'>;
  'loan-cost': JsonBody<'/api/tools/loan-cost'>;
}
export type ToolEndpoint = keyof ToolRequests;

/** Local code for a request that never reached the backend (offline or timed out). */
export const NETWORK_ERROR = 'network_error';

/** The backend's error envelope, as a typed error. */
export class IrisApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly agentMessage: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'IrisApiError';
  }
}

export interface IrisApi {
  agentConfig(greet: boolean, voice: VoiceChoice): Promise<AgentConfig>;
  voiceToken(): Promise<VoiceToken>;
  registerPage(snapshot: PageSnapshot): Promise<CreatePageResponse>;
  scan(pageId: string, excludeKeys: readonly string[]): Promise<ScanResult>;
  tool<E extends ToolEndpoint>(endpoint: E, body: ToolRequests[E]): Promise<ToolResult>;
  /** The rolling summary of a tab's earlier pages. */
  journeySummary(facts: string[], previousSummary: string | null): Promise<JourneySummary>;
  /** The walkthrough's explanations for up to 5 sections or form steps. */
  walkthrough(
    pageId: string,
    steps: { section_ids: string[] } | { form_steps: FormStep[] },
  ): Promise<Walkthrough>;
}

const TOOL_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function toApiError(response: Response): Promise<IrisApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not an envelope (for example a proxy error page); fall through to a generic error.
  }
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (error && typeof error.code === 'string') {
    return new IrisApiError(
      error.code,
      typeof error.message === 'string' ? error.message : COPY.errors.backendUnreachable,
      typeof error.agent_message === 'string' ? error.agent_message : COPY.agent.backendUnreachable,
      response.status,
      typeof error.retry_after_seconds === 'number' ? error.retry_after_seconds : null,
    );
  }
  return new IrisApiError(
    'internal_error',
    COPY.errors.backendUnreachable,
    COPY.agent.backendUnreachable,
    response.status,
  );
}

export function createApi(base: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): IrisApi {
  const root = base.replace(/\/+$/, '');

  async function request<T>(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { 'X-Iris-Contract': '1' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetchImpl(root + path, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch {
      throw new IrisApiError(
        NETWORK_ERROR,
        COPY.errors.backendUnreachable,
        COPY.agent.backendUnreachable,
        0,
      );
    }
    if (!response.ok) throw await toApiError(response);
    return (await response.json()) as T;
  }

  return {
    agentConfig: (greet, voice) =>
      request<AgentConfig>(`/agent-config?greet=${String(greet)}&voice=${voice}`),
    voiceToken: () => request<VoiceToken>('/voice-token'),
    registerPage: (snapshot) =>
      request<CreatePageResponse>('/pages', { method: 'POST', body: { snapshot } }),
    scan: (pageId, excludeKeys) => {
      const query = excludeKeys.length
        ? `?exclude_keys=${encodeURIComponent(excludeKeys.join(','))}`
        : '';
      return request<ScanResult>(`/pages/${encodeURIComponent(pageId)}/scan${query}`);
    },
    tool: (endpoint, body) =>
      request<ToolResult>(`/tools/${endpoint}`, {
        method: 'POST',
        body,
        timeoutMs: TOOL_TIMEOUT_MS,
      }),
    walkthrough: (pageId, steps) =>
      request<Walkthrough>('/tools/walkthrough', {
        method: 'POST',
        body: { page_id: pageId, ...steps },
        timeoutMs: TOOL_TIMEOUT_MS,
      }),
    journeySummary: (facts, previousSummary) =>
      request<JourneySummary>('/journey/summary', {
        method: 'POST',
        body: { facts, previous_summary: previousSummary },
        timeoutMs: TOOL_TIMEOUT_MS,
      }),
  };
}
