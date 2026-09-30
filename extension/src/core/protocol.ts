/**
 * AssemblyAI Voice Agent events, as documented in the Voice Agent API events reference.
 * Only the fields Iris uses are typed; anything else in an event is ignored.
 */
import type { AgentSession } from './api';

export const VOICE_AGENT_URL = 'wss://agents.assemblyai.com/v1/ws';

/** Codes the docs call transient: one reconnect is allowed. */
export const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'at_capacity',
  'concurrency_exceeded',
  'internal_error',
]);

export interface ToolCallEvent {
  type: 'tool.call';
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ReplyStatus = 'completed' | 'interrupted';

export type ServerEvent =
  | { type: 'session.ready'; session_id: string }
  | { type: 'input.speech.started' }
  | { type: 'input.speech.stopped' }
  | { type: 'transcript.user.delta'; item_id: string | null; text: string }
  | { type: 'transcript.user'; item_id: string | null; text: string }
  | { type: 'reply.started'; reply_id: string | null }
  | { type: 'reply.audio'; data: string }
  | {
      type: 'transcript.agent.delta';
      reply_id: string | null;
      delta: string;
      start_ms: number | null;
      end_ms: number | null;
    }
  | { type: 'transcript.agent'; reply_id: string | null; text: string }
  | { type: 'reply.done'; reply_id: string | null; status: ReplyStatus }
  | ToolCallEvent
  | { type: 'session.error'; code: string; message: string }
  | { type: 'session.ended' };

export type ClientEvent =
  | { type: 'session.update'; session: AgentSession | Pick<AgentSession, 'system_prompt'> }
  | { type: 'session.resume'; session_id: string }
  | { type: 'session.end' }
  | { type: 'input.audio'; audio: string }
  | { type: 'reply.create'; instructions?: string }
  | { type: 'tool.result'; call_id: string; result: string; is_error: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Parses one WebSocket message. Unknown or malformed events return null. */
export function parseServerEvent(data: unknown): ServerEvent | null {
  if (typeof data !== 'string') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case 'session.ready': {
      const sessionId = str(raw.session_id);
      return sessionId ? { type: 'session.ready', session_id: sessionId } : null;
    }
    case 'input.speech.started':
    case 'input.speech.stopped':
    case 'session.ended':
      return { type: raw.type };
    case 'transcript.user.delta':
    case 'transcript.user':
      return { type: raw.type, item_id: str(raw.item_id), text: str(raw.text) ?? '' };
    case 'reply.started':
      return { type: 'reply.started', reply_id: str(raw.reply_id) };
    case 'reply.audio': {
      const audio = str(raw.data);
      return audio === null ? null : { type: 'reply.audio', data: audio };
    }
    case 'transcript.agent.delta':
      return {
        type: 'transcript.agent.delta',
        reply_id: str(raw.reply_id),
        delta: str(raw.delta) ?? '',
        start_ms: num(raw.start_ms),
        end_ms: num(raw.end_ms),
      };
    case 'transcript.agent':
      return { type: 'transcript.agent', reply_id: str(raw.reply_id), text: str(raw.text) ?? '' };
    case 'reply.done':
      return {
        type: 'reply.done',
        reply_id: str(raw.reply_id),
        status: raw.status === 'interrupted' ? 'interrupted' : 'completed',
      };
    case 'tool.call': {
      const callId = str(raw.call_id);
      const name = str(raw.name);
      if (!callId || !name) return null;
      return {
        type: 'tool.call',
        call_id: callId,
        name,
        arguments: isRecord(raw.arguments) ? raw.arguments : {},
      };
    }
    case 'session.error':
    case 'error':
      return {
        type: 'session.error',
        code: str(raw.code) ?? 'unknown',
        message: str(raw.message) ?? '',
      };
    default:
      return null;
  }
}
