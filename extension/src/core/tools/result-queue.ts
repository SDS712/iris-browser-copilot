/**
 * Holds tool results until the agent is idle, following AssemblyAI's documented pattern
 * (client-side tools): track the latest of reply.started, input.speech.started and
 * reply.done; send only when it's reply.done; drop everything when a reply is interrupted.
 */
import type { ClientEvent } from '../protocol';

type TrackedEvent = 'reply.started' | 'input.speech.started' | 'reply.done';
type ToolResultEvent = Extract<ClientEvent, { type: 'tool.result' }>;

export class ToolResultQueue {
  private latest: TrackedEvent | null = null;
  private pending: ToolResultEvent[] = [];
  /** Calls started before an interrupted reply: their late results are stale. */
  private readonly stale = new Set<string>();
  private readonly running = new Set<string>();

  constructor(private readonly send: (event: ToolResultEvent) => void) {}

  get latestEvent(): TrackedEvent | null {
    return this.latest;
  }

  get hasWork(): boolean {
    return this.running.size > 0 || this.pending.length > 0;
  }

  /** A tool.call arrived and its handler started. */
  started(callId: string): void {
    this.running.add(callId);
  }

  /** Returns true if results were sent. */
  noteEvent(type: TrackedEvent, interrupted = false): boolean {
    this.latest = type;
    if (type !== 'reply.done') return false;
    if (interrupted) {
      this.pending = [];
      for (const callId of this.running) this.stale.add(callId);
      this.running.clear();
      return false;
    }
    return this.flush();
  }

  /** A handler finished. Tries to send at once, in case reply.done already arrived. */
  push(callId: string, result: unknown, isError: boolean): void {
    this.running.delete(callId);
    if (this.stale.delete(callId)) return;
    this.pending.push({
      type: 'tool.result',
      call_id: callId,
      result: JSON.stringify(result),
      is_error: isError,
    });
    this.flush();
  }

  /** Returns true if anything was sent. */
  flush(): boolean {
    if (this.latest !== 'reply.done' || this.pending.length === 0) return false;
    const toSend = this.pending;
    this.pending = [];
    for (const event of toSend) this.send(event);
    return true;
  }

  reset(): void {
    this.latest = null;
    this.pending = [];
    this.stale.clear();
    this.running.clear();
  }
}
