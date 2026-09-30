import { describe, expect, it } from 'vitest';
import { ToolResultQueue } from '../../src/core/tools/result-queue';

function makeQueue() {
  const sent: string[] = [];
  const queue = new ToolResultQueue((event) => sent.push(event.call_id));
  return { queue, sent };
}

describe('tool result queue', () => {
  it('holds a result while a reply is in flight and sends it on reply.done', () => {
    const { queue, sent } = makeQueue();
    queue.noteEvent('reply.started');
    queue.started('c1');
    queue.push('c1', { say: 'hi' }, false);
    expect(sent).toEqual([]);
    expect(queue.noteEvent('reply.done')).toBe(true);
    expect(sent).toEqual(['c1']);
  });

  it('sends at once when reply.done arrived before the tool finished', () => {
    const { queue, sent } = makeQueue();
    queue.noteEvent('reply.started');
    queue.started('c1');
    queue.noteEvent('reply.done');
    queue.push('c1', {}, false);
    expect(sent).toEqual(['c1']);
  });

  it('holds results while the user is speaking', () => {
    const { queue, sent } = makeQueue();
    queue.noteEvent('reply.done');
    queue.noteEvent('input.speech.started');
    queue.push('c1', {}, false);
    expect(sent).toEqual([]);
  });

  it('drops pending results when a reply is interrupted, and late ones too', () => {
    const { queue, sent } = makeQueue();
    queue.noteEvent('reply.started');
    queue.started('c1');
    queue.started('c2');
    queue.push('c1', {}, false);
    queue.noteEvent('reply.done', true);
    queue.push('c2', {}, false);
    expect(sent).toEqual([]);
    expect(queue.hasWork).toBe(false);
  });

  it('serialises the result as a JSON string with is_error', () => {
    const events: unknown[] = [];
    const queue = new ToolResultQueue((event) => events.push(event));
    queue.noteEvent('reply.done');
    queue.push('c9', { error: 'nope' }, true);
    expect(events).toEqual([
      { type: 'tool.result', call_id: 'c9', result: '{"error":"nope"}', is_error: true },
    ]);
  });
});
