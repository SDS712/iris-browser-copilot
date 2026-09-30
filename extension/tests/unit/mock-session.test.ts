import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockVoiceSession, quotedLine } from '../../src/core/mock-session';
import { createStore } from '../../src/core/store';

function setup() {
  const store = createStore();
  const hooks = {
    onReady: vi.fn(),
    onResumed: vi.fn(),
    onToolCall: vi.fn(),
    onUserFinal: vi.fn(),
    onEnded: vi.fn(),
  };
  return { store, hooks, session: new MockVoiceSession({ store, hooks }) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('mock voice', () => {
  it('goes from connecting to listening and sends the page context', async () => {
    const { store, hooks, session } = setup();
    const started = session.start({ greet: true });
    expect(store.session.state.value).toBe('connecting');
    await vi.advanceTimersByTimeAsync(300);
    await started;
    expect(store.session.state.value).toBe('listening');
    expect(hooks.onReady).toHaveBeenCalledTimes(1);
  });

  it('turns a typed question into ask_page and captions the say line for 3 seconds', async () => {
    const { store, hooks, session } = setup();
    session.sendUserText('Can I cancel anytime?');
    await vi.advanceTimersByTimeAsync(300);
    expect(hooks.onToolCall).toHaveBeenCalledWith({
      type: 'tool.call',
      call_id: 'mock-call-1',
      name: 'ask_page',
      arguments: { question: 'Can I cancel anytime?' },
    });
    expect(store.session.state.value).toBe('thinking');
    session.submitToolResult('mock-call-1', { say: 'Yes, with 30 days notice.' }, false);
    expect(store.session.state.value).toBe('speaking');
    expect(store.session.agentLive.value).toBe('Yes, with 30 days notice.');
    expect(store.session.spoken.value).toEqual(['Yes, with 30 days notice.']);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(store.session.state.value).toBe('listening');
    expect(store.session.agentLive.value).toBe('');
  });

  it('speaks error results and quoted nudge lines', async () => {
    const { store, session } = setup();
    const started = session.start({ greet: false });
    await vi.advanceTimersByTimeAsync(300);
    await started;
    session.submitToolResult('c1', { error: 'Web search is unavailable.' }, true);
    session.createReply('Tell the user this now, keeping every figure: "Before you pay: ₹49."');
    expect(store.session.spoken.value).toEqual(['Web search is unavailable.']);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(store.session.spoken.value).toEqual([
      'Web search is unavailable.',
      'Before you pay: ₹49.',
    ]);
  });

  it('ends back to idle', async () => {
    const { store, hooks, session } = setup();
    const started = session.start({ greet: true });
    await vi.advanceTimersByTimeAsync(300);
    await started;
    await session.end();
    expect(store.session.state.value).toBe('idle');
    expect(hooks.onEnded).toHaveBeenCalled();
  });

  it('finds the quoted line at the end of instructions', () => {
    expect(quotedLine('Tell the user: "Heads up: 36.5% a year."')).toBe('Heads up: 36.5% a year.');
    expect(quotedLine('Tell the user in one short sentence.')).toBeNull();
  });
});
