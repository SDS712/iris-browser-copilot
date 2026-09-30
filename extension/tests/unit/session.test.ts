import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IrisApiError, type AgentConfig } from '../../src/core/api';
import { MicUnavailableError, type Capture } from '../../src/core/audio/capture';
import type { AudioIO } from '../../src/core/audio/io';
import type { Playback } from '../../src/core/audio/playback';
import { COPY } from '../../src/core/copy';
import type { ClientEvent, ServerEvent } from '../../src/core/protocol';
import {
  appendDelta,
  RESUME_DELAY_MS,
  VoiceSession,
  type SessionHooks,
  type SocketLike,
} from '../../src/core/session';
import { createStore, type IrisStore } from '../../src/core/store';

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: ClientEvent[] = [];

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientEvent);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.(new Event('close') as CloseEvent);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  receive(event: ServerEvent | Record<string, unknown>): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
  }

  /** The network drops: no session.ended. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.(new Event('close') as CloseEvent);
  }

  types(): string[] {
    return this.sent.map((event) => event.type);
  }
}

const CONFIG: AgentConfig = {
  contract_version: 1,
  max_session_seconds: 600,
  warn_before_end_seconds: 60,
  session: {
    system_prompt: 'You are Iris.',
    greeting: 'Hi',
    input: { format: { encoding: 'audio/pcm' }, keyterms: ['NACH'] },
    output: { voice: 'alba', format: { encoding: 'audio/pcm' } },
    tools: [],
  },
};

function fakeAudio() {
  let idle = true;
  const idleCallbacks = new Set<() => void>();
  const playback = {
    context: { state: 'running', onstatechange: null, resume: vi.fn(() => Promise.resolve()) },
    analyser: null,
    enqueue: vi.fn(() => {
      idle = false;
    }),
    flush: vi.fn(() => {
      idle = true;
    }),
    isIdle: () => idle,
    onIdle: (callback: () => void) => {
      idleCallbacks.add(callback);
      return () => idleCallbacks.delete(callback);
    },
    beginReply: vi.fn(),
    replyElapsedMs: vi.fn(() => 0),
    chime: vi.fn(),
    close: vi.fn(),
  };
  const capture = { analyser: null, setEnabled: vi.fn(), stop: vi.fn() };
  let onFrame: ((frame: ArrayBuffer) => void) | null = null;
  let onEnded: (() => void) | null = null;
  const set = {
    playback: playback as unknown as Playback,
    startCapture: vi.fn((callback: (frame: ArrayBuffer) => void, ended: () => void) => {
      onFrame = callback;
      onEnded = ended;
      return Promise.resolve(capture as unknown as Capture);
    }),
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(),
  };
  const io: AudioIO = { open: () => set };
  return {
    io,
    set,
    playback,
    capture,
    frame: () => onFrame?.(new Int16Array(1200).buffer),
    /** The browser ended the track (permission taken back, device unplugged). */
    endTrack: () => onEnded?.(),
    finishPlaying: () => {
      idle = true;
      for (const callback of [...idleCallbacks]) callback();
    },
  };
}

interface Harness {
  session: VoiceSession;
  store: IrisStore;
  audio: ReturnType<typeof fakeAudio>;
  sockets: FakeSocket[];
  hooks: { [K in keyof SessionHooks]: ReturnType<typeof vi.fn> };
  api: { agentConfig: ReturnType<typeof vi.fn>; voiceToken: ReturnType<typeof vi.fn> };
  socket(): FakeSocket;
}

function setup(): Harness {
  const store = createStore();
  const audio = fakeAudio();
  const sockets: FakeSocket[] = [];
  let tokens = 0;
  const api = {
    agentConfig: vi.fn(() => Promise.resolve(CONFIG)),
    voiceToken: vi.fn(() => {
      tokens += 1;
      return Promise.resolve({
        contract_version: 1 as const,
        token: `tok-${tokens}`,
        expires_in_seconds: 300,
        max_session_seconds: 600,
      });
    }),
  };
  const hooks = {
    onReady: vi.fn(),
    onResumed: vi.fn(),
    onToolCall: vi.fn(),
    onUserFinal: vi.fn(),
    onEnded: vi.fn(),
  };
  const session = new VoiceSession({
    api,
    store,
    audio: audio.io,
    hooks,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    startLevels: () => () => undefined,
  });
  return {
    session,
    store,
    audio,
    sockets,
    hooks,
    api,
    socket: () => {
      const last = sockets.at(-1);
      if (!last) throw new Error('no socket yet');
      return last;
    },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

async function startLive(h: Harness, greet = true): Promise<FakeSocket> {
  const started = h.session.start({ greet });
  await flush();
  const socket = h.socket();
  socket.open();
  socket.receive({ type: 'session.ready', session_id: 'sess_1' });
  await started;
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('starting a session', () => {
  it('sends session.update first, with the agent-config session unchanged', async () => {
    const h = setup();
    const socket = await startLive(h);
    expect(socket.url).toBe('wss://agents.assemblyai.com/v1/ws?token=tok-1');
    expect(socket.sent[0]).toEqual({ type: 'session.update', session: CONFIG.session });
    expect(h.api.agentConfig).toHaveBeenCalledWith(true, 'female');
    expect(h.store.session.voice.value).toBe('female');
    expect(h.store.session.state.value).toBe('listening');
    expect(h.hooks.onReady).toHaveBeenCalledTimes(1);
  });

  it('asks for the voice setting, and keeps that voice until the session ends', async () => {
    const h = setup();
    h.store.settings.value = { ...h.store.settings.value, voice: 'male' };
    await startLive(h);
    expect(h.api.agentConfig).toHaveBeenLastCalledWith(true, 'male');
    // A change mid-session applies from the next one: AssemblyAI can't switch voices.
    h.store.settings.value = { ...h.store.settings.value, voice: 'female' };
    expect(h.store.session.voice.value).toBe('male');
    h.session.endNow();
    expect(h.store.session.voice.value).toBeNull();
    await startLive(h);
    expect(h.api.agentConfig).toHaveBeenLastCalledWith(true, 'female');
    expect(h.store.session.voice.value).toBe('female');
  });

  it('a handed-over session keeps the voice it started with', async () => {
    const h = setup();
    void h.session.start({
      greet: false,
      resume: { session_id: 'sess_1', started_at: Date.now(), voice: 'male' },
    });
    await flush();
    expect(h.api.agentConfig).toHaveBeenCalledWith(false, 'male');
    expect(h.store.session.voice.value).toBe('male');
  });

  it('sends no audio before session.ready, then streams frames', async () => {
    const h = setup();
    const started = h.session.start({ greet: true });
    await flush();
    const socket = h.socket();
    socket.open();
    h.audio.frame();
    expect(socket.types()).not.toContain('input.audio');
    socket.receive({ type: 'session.ready', session_id: 'sess_1' });
    await started;
    h.audio.frame();
    expect(socket.types().filter((t) => t === 'input.audio')).toHaveLength(1);
    const audio = socket.sent.find((event) => event.type === 'input.audio');
    expect(audio && 'audio' in audio ? audio.audio.length : 0).toBe(3200);
  });

  it('shows the limit message and stops on budget_exhausted_daily', async () => {
    const h = setup();
    h.api.voiceToken.mockRejectedValueOnce(
      new IrisApiError('budget_exhausted_daily', "The demo has hit today's limit.", 'x', 429),
    );
    await h.session.start({ greet: true });
    expect(h.sockets).toHaveLength(0);
    expect(h.store.session.state.value).toBe('idle');
    expect(h.store.notice.value).toEqual({
      kind: 'limit',
      message: "The demo has hit today's limit.",
    });
    expect(h.audio.set.close).toHaveBeenCalled();
  });

  it('continues in typed-only mode when the mic is denied', async () => {
    const h = setup();
    h.audio.set.startCapture.mockRejectedValueOnce(new MicUnavailableError(true));
    await startLive(h);
    expect(h.store.session.micAvailable.value).toBe(false);
    expect(h.store.notice.value).toEqual({ kind: 'mic', message: COPY.errors.micBlocked });
    expect(h.store.session.state.value).toBe('listening');
  });
});

describe('events', () => {
  it('follows the conversation states and captions', async () => {
    const h = setup();
    const socket = await startLive(h);
    socket.receive({ type: 'input.speech.started' });
    expect(h.store.session.state.value).toBe('hearing');
    socket.receive({ type: 'transcript.user.delta', item_id: 'i1', text: 'Can I' });
    socket.receive({ type: 'transcript.user.delta', item_id: 'i1', text: 'Can I cancel' });
    expect(h.store.session.userLive.value).toBe('Can I cancel');
    socket.receive({ type: 'input.speech.stopped' });
    expect(h.store.session.state.value).toBe('thinking');
    socket.receive({ type: 'transcript.user', item_id: 'i1', text: 'Can I cancel anytime?' });
    expect(h.hooks.onUserFinal).toHaveBeenCalledWith('Can I cancel anytime?');
    socket.receive({ type: 'reply.started', reply_id: 'r1' });
    expect(h.store.session.state.value).toBe('speaking');
    socket.receive({ type: 'reply.audio', data: 'AAAA' });
    expect(h.audio.playback.enqueue).toHaveBeenCalledWith('AAAA');
    socket.receive({ type: 'transcript.agent.delta', reply_id: 'r1', delta: 'Yes,' });
    socket.receive({ type: 'transcript.agent.delta', reply_id: 'r1', delta: 'you' });
    socket.receive({ type: 'transcript.agent.delta', reply_id: 'r1', delta: 'can.' });
    expect(h.store.session.agentLive.value).toBe('Yes, you can.');
    socket.receive({ type: 'transcript.agent', reply_id: 'r1', text: 'Yes, you can.' });
    socket.receive({ type: 'reply.done', reply_id: 'r1', status: 'completed' });
    // Still speaking until the audio has played out.
    expect(h.store.session.state.value).toBe('speaking');
    h.audio.finishPlaying();
    expect(h.store.session.state.value).toBe('listening');
    expect(h.store.session.transcript.value.map((line) => [line.who, line.text])).toEqual([
      ['you', 'Can I cancel anytime?'],
      ['iris', 'Yes, you can.'],
    ]);
    expect(h.store.session.spoken.value).toEqual(['Yes, you can.']);
  });

  it('stops playback at once when the user starts talking over Iris', async () => {
    const h = setup();
    const socket = await startLive(h);
    socket.receive({ type: 'reply.started', reply_id: 'r1' });
    socket.receive({ type: 'reply.audio', data: 'AAAA' });
    socket.receive({ type: 'input.speech.started' });
    expect(h.audio.playback.flush).toHaveBeenCalled();
    expect(h.store.session.state.value).toBe('hearing');
  });

  it('trims an interrupted line to the words heard and returns to hearing', async () => {
    const h = setup();
    const socket = await startLive(h);
    socket.receive({ type: 'reply.started', reply_id: 'r1' });
    for (const [i, word] of ['One', 'two', 'three', 'four'].entries()) {
      socket.receive({
        type: 'transcript.agent.delta',
        reply_id: 'r1',
        delta: word,
        start_ms: i * 400,
        end_ms: i * 400 + 300,
      });
    }
    socket.receive({ type: 'transcript.agent', reply_id: 'r1', text: 'One two three four' });
    h.audio.playback.replyElapsedMs.mockReturnValue(500);
    socket.receive({ type: 'reply.done', reply_id: 'r1', status: 'interrupted' });
    expect(h.store.session.state.value).toBe('hearing');
    expect(h.store.session.transcript.value.at(-1)?.text).toBe('One two…');
  });

  it('Esc stops the audio at once and drops the rest of that reply', async () => {
    const h = setup();
    const socket = await startLive(h);
    socket.receive({ type: 'reply.started', reply_id: 'r1' });
    socket.receive({ type: 'reply.audio', data: 'AAAA' });
    h.session.stopAudio();
    expect(h.audio.playback.flush).toHaveBeenCalled();
    expect(h.store.session.state.value).toBe('listening');
    h.audio.playback.enqueue.mockClear();
    socket.receive({ type: 'reply.audio', data: 'BBBB' });
    expect(h.audio.playback.enqueue).not.toHaveBeenCalled();
    socket.receive({ type: 'reply.started', reply_id: 'r2' });
    socket.receive({ type: 'reply.audio', data: 'CCCC' });
    expect(h.audio.playback.enqueue).toHaveBeenCalledTimes(1);
  });

  it('adds spaces between agent words only where they belong', () => {
    expect(appendDelta('Yes', ',')).toBe('Yes,');
    expect(appendDelta('Yes,', 'you')).toBe('Yes, you');
    expect(appendDelta('costs ₹', '499')).toBe('costs ₹499');
    expect(appendDelta('Hi', ' there')).toBe('Hi there');
  });
});

describe('tool results', () => {
  it('sends a result only after reply.done', async () => {
    const h = setup();
    const socket = await startLive(h);
    socket.receive({ type: 'reply.started', reply_id: 'r1' });
    socket.receive({
      type: 'tool.call',
      call_id: 'c1',
      name: 'ask_page',
      arguments: { question: 'q' },
    });
    expect(h.hooks.onToolCall).toHaveBeenCalledWith({
      type: 'tool.call',
      call_id: 'c1',
      name: 'ask_page',
      arguments: { question: 'q' },
    });
    expect(h.store.session.state.value).toBe('thinking');
    h.session.submitToolResult('c1', { say: 'Yes.' }, false);
    expect(socket.types()).not.toContain('tool.result');
    socket.receive({ type: 'reply.done', reply_id: 'r1', status: 'completed' });
    expect(socket.sent.at(-1)).toEqual({
      type: 'tool.result',
      call_id: 'c1',
      result: '{"say":"Yes."}',
      is_error: false,
    });
    expect(h.store.session.state.value).toBe('thinking');
  });

  it('flushes a result that finishes after reply.done', async () => {
    const h = setup();
    const socket = await startLive(h);
    socket.receive({ type: 'reply.started', reply_id: 'r1' });
    socket.receive({ type: 'tool.call', call_id: 'c1', name: 'ask_page', arguments: {} });
    socket.receive({ type: 'reply.done', reply_id: 'r1', status: 'completed' });
    expect(socket.types()).not.toContain('tool.result');
    h.session.submitToolResult('c1', { say: 'Late.' }, false);
    expect(socket.types().at(-1)).toBe('tool.result');
  });

  it('drops results when the reply is interrupted', async () => {
    const h = setup();
    const socket = await startLive(h);
    socket.receive({ type: 'reply.started', reply_id: 'r1' });
    socket.receive({ type: 'tool.call', call_id: 'c1', name: 'ask_page', arguments: {} });
    h.session.submitToolResult('c1', { say: 'x' }, false);
    socket.receive({ type: 'reply.done', reply_id: 'r1', status: 'interrupted' });
    socket.receive({ type: 'reply.done', reply_id: 'r2', status: 'completed' });
    expect(socket.types()).not.toContain('tool.result');
  });
});

describe('typed questions and page context', () => {
  // AssemblyAI accepts conversation.message but the agent never sees it (checked against the
  // live API on 2026-09-28), so typed text travels in reply.create instructions instead.
  it('sends a typed question as reply.create instructions, never as conversation.message', async () => {
    const h = setup();
    const socket = await startLive(h);
    h.session.sendUserText('  Can I cancel?  ');
    expect(socket.sent.at(-1)).toEqual({
      type: 'reply.create',
      instructions: COPY.typed('Can I cancel?'),
    });
    expect(socket.types()).not.toContain('conversation.message');
    expect(h.store.session.transcript.value.at(-1)).toMatchObject({
      who: 'you',
      text: 'Can I cancel?',
    });
  });

  it('starts a session without a greeting when idle, then sends the question', async () => {
    const h = setup();
    h.session.sendUserText('What is this?');
    expect(h.store.session.state.value).toBe('connecting');
    await flush();
    const socket = h.socket();
    socket.open();
    socket.receive({ type: 'session.ready', session_id: 'sess_1' });
    expect(h.api.agentConfig).toHaveBeenCalledWith(false, 'female');
    expect(socket.types()).toEqual(['session.update', 'reply.create']);
  });

  it('puts the page context into the system prompt, replacing the previous one', async () => {
    const h = setup();
    const socket = await startLive(h);
    h.session.setPageContext('PAGE CONTEXT (do not read aloud):\nPAGE: one');
    h.session.setPageContext('PAGE CONTEXT (do not read aloud):\nPAGE: two');
    expect(socket.sent.slice(-2)).toEqual([
      {
        type: 'session.update',
        session: { system_prompt: 'You are Iris.\n\nPAGE CONTEXT (do not read aloud):\nPAGE: one' },
      },
      {
        type: 'session.update',
        session: { system_prompt: 'You are Iris.\n\nPAGE CONTEXT (do not read aloud):\nPAGE: two' },
      },
    ]);
  });

  it('sends the page context before a question typed while connecting', async () => {
    const h = setup();
    h.hooks.onReady.mockImplementation(() => {
      h.session.setPageContext('PAGE CONTEXT (do not read aloud):\nPAGE: x');
    });
    h.session.sendUserText('What is this?');
    await flush();
    const socket = h.socket();
    socket.open();
    socket.receive({ type: 'session.ready', session_id: 'sess_1' });
    expect(socket.types()).toEqual(['session.update', 'session.update', 'reply.create']);
  });

  it('sends reply.create with instructions', async () => {
    const h = setup();
    const socket = await startLive(h);
    h.session.createReply('Tell the user this now: "Hi"');
    expect(socket.sent.at(-1)).toEqual({
      type: 'reply.create',
      instructions: 'Tell the user this now: "Hi"',
    });
  });
});

describe('losing the microphone mid-session', () => {
  it('shows the microphone notice when the track ends, and captures again once allowed', async () => {
    const h = setup();
    const socket = await startLive(h);
    h.audio.endTrack();
    expect(h.store.session.micAvailable.value).toBe(false);
    expect(h.store.notice.value).toEqual({ kind: 'mic', message: COPY.errors.micBlocked });
    expect(h.audio.capture.stop).toHaveBeenCalled();

    await h.session.retryMicrophone();
    expect(h.audio.set.startCapture).toHaveBeenCalledTimes(2);
    expect(h.store.session.micAvailable.value).toBe(true);
    expect(h.store.notice.value).toBeNull();
    h.audio.frame();
    expect(socket.types()).toContain('input.audio');
    expect(h.session.isRunning).toBe(true);
  });

  it('does nothing on retry while the microphone works, or with no session', async () => {
    const h = setup();
    await h.session.retryMicrophone();
    expect(h.audio.set.startCapture).not.toHaveBeenCalled();
    await startLive(h);
    await h.session.retryMicrophone();
    expect(h.audio.set.startCapture).toHaveBeenCalledTimes(1);
  });
});

describe('mute', () => {
  it('disables the track, sends no audio and shows muted', async () => {
    const h = setup();
    const socket = await startLive(h);
    h.session.setMuted(true);
    expect(h.audio.capture.setEnabled).toHaveBeenLastCalledWith(false);
    expect(h.store.session.state.value).toBe('muted');
    h.audio.frame();
    expect(socket.types()).not.toContain('input.audio');
    h.session.setMuted(false);
    expect(h.store.session.state.value).toBe('listening');
    h.audio.frame();
    expect(socket.types()).toContain('input.audio');
  });
});

describe('ending', () => {
  it('sends session.end, waits for session.ended, then cleans up', async () => {
    const h = setup();
    const socket = await startLive(h);
    const ended = h.session.end();
    expect(socket.types().at(-1)).toBe('session.end');
    socket.receive({ type: 'session.ended' });
    await ended;
    expect(h.store.session.state.value).toBe('idle');
    expect(h.audio.set.close).toHaveBeenCalled();
    expect(h.hooks.onEnded).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting for session.ended after 2 seconds', async () => {
    const h = setup();
    await startLive(h);
    const ended = h.session.end();
    await vi.advanceTimersByTimeAsync(2_000);
    await ended;
    expect(h.store.session.state.value).toBe('idle');
  });

  it('sends session.end synchronously on pagehide', async () => {
    const h = setup();
    const socket = await startLive(h);
    h.session.endNow();
    expect(socket.types().at(-1)).toBe('session.end');
    expect(h.store.session.state.value).toBe('idle');
  });

  it('warns a minute before the limit and ends at the limit', async () => {
    const h = setup();
    const socket = await startLive(h);
    await vi.advanceTimersByTimeAsync(540_000);
    expect(socket.sent.at(-1)).toEqual({
      type: 'reply.create',
      instructions: COPY.sessionEndingSoon,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.types().at(-1)).toBe('session.end');
    socket.receive({ type: 'session.ended' });
    await flush();
    expect(h.store.session.state.value).toBe('idle');
    expect(h.store.notice.value).toEqual({ kind: 'timeout', message: COPY.errors.timedOut });
  });
});

describe('reconnecting', () => {
  it('resumes a dropped session after a short pause, with a new token and session.resume first', async () => {
    const h = setup();
    const first = await startLive(h);
    first.drop();
    expect(h.store.session.state.value).toBe('connecting');
    await vi.advanceTimersByTimeAsync(RESUME_DELAY_MS - 1);
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const second = h.socket();
    expect(second).not.toBe(first);
    expect(second.url).toContain('token=tok-2');
    second.open();
    expect(second.sent[0]).toEqual({ type: 'session.resume', session_id: 'sess_1' });
    second.receive({ type: 'session.ready', session_id: 'sess_1' });
    expect(h.store.session.state.value).toBe('listening');
    // The conversation survives a resume, so the page context isn't sent again.
    expect(h.hooks.onReady).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh session (no second greeting) when the server refuses the resume', async () => {
    const h = setup();
    const first = await startLive(h);
    first.drop();
    await vi.advanceTimersByTimeAsync(RESUME_DELAY_MS);
    const second = h.socket();
    second.open();
    second.receive({ type: 'session.error', code: 'session_not_found', message: 'gone' });
    await flush();
    const third = h.socket();
    expect(third).not.toBe(second);
    expect(third.url).toContain('token=tok-3');
    third.open();
    const update = third.sent[0];
    expect(update?.type).toBe('session.update');
    expect(
      update && 'session' in update && 'greeting' in update.session
        ? update.session.greeting
        : undefined,
    ).toBeUndefined();
    third.receive({ type: 'session.ready', session_id: 'sess_2' });
    expect(h.store.session.state.value).toBe('listening');
    // A new session on the server: the page context goes in again.
    expect(h.hooks.onReady).toHaveBeenCalledTimes(2);
  });

  it('shows "Connection lost" when the fresh start fails too', async () => {
    const h = setup();
    const first = await startLive(h);
    first.drop();
    await vi.advanceTimersByTimeAsync(RESUME_DELAY_MS);
    const second = h.socket();
    second.open();
    second.receive({ type: 'session.error', code: 'session_not_found', message: 'gone' });
    await flush();
    const third = h.socket();
    third.open();
    third.receive({ type: 'session.error', code: 'session_not_found', message: 'gone' });
    expect(h.store.session.state.value).toBe('error');
    expect(h.audio.set.close).toHaveBeenCalled();
  });

  it('tries only once', async () => {
    const h = setup();
    const first = await startLive(h);
    first.drop();
    await vi.advanceTimersByTimeAsync(RESUME_DELAY_MS);
    const second = h.socket();
    second.open();
    second.receive({ type: 'session.ready', session_id: 'sess_1' });
    second.drop();
    await vi.advanceTimersByTimeAsync(RESUME_DELAY_MS);
    expect(h.sockets).toHaveLength(2);
    expect(h.store.session.state.value).toBe('error');
  });

  it('starts afresh once after a retryable error before the session is ready', async () => {
    const h = setup();
    const started = h.session.start({ greet: true });
    await flush();
    const first = h.socket();
    first.open();
    first.receive({ type: 'session.error', code: 'at_capacity', message: 'busy' });
    await flush();
    const second = h.socket();
    expect(second).not.toBe(first);
    second.open();
    expect(second.sent[0]?.type).toBe('session.update');
    second.receive({ type: 'session.ready', session_id: 'sess_2' });
    await started;
    expect(h.store.session.state.value).toBe('listening');
  });

  it('treats other session errors as fatal', async () => {
    const h = setup();
    const socket = await startLive(h);
    socket.receive({ type: 'session.error', code: 'invalid_request', message: 'bad' });
    expect(h.store.session.state.value).toBe('error');
    expect(h.sockets).toHaveLength(1);
  });
});

describe('carrying a session to the next page', () => {
  it('hands over without session.end, leaving the socket for the browser to close', async () => {
    vi.setSystemTime(5_000);
    const h = setup();
    const socket = await startLive(h);
    const closed = vi.spyOn(socket, 'close');
    expect(h.session.handOver()).toEqual({
      session_id: 'sess_1',
      started_at: 5_000,
      voice: 'female',
    });
    expect(socket.types()).not.toContain('session.end');
    expect(closed).not.toHaveBeenCalled();
    expect(h.session.isRunning).toBe(false);
    expect(h.session.handOver()).toBeNull();
  });

  it('resumes on the new page with session.resume first, and no greeting asked for', async () => {
    const h = setup();
    const started = h.session.start({
      greet: false,
      resume: { session_id: 'sess_1', started_at: Date.now() },
    });
    await flush();
    const socket = h.socket();
    socket.open();
    expect(socket.sent[0]).toEqual({ type: 'session.resume', session_id: 'sess_1' });
    expect(h.api.agentConfig).toHaveBeenCalledWith(false, 'female');
    // Any event but an error means the server took the resume.
    socket.receive({ type: 'session.updated' });
    await started;
    expect(h.store.session.state.value).toBe('listening');
    expect(h.hooks.onResumed).toHaveBeenCalledTimes(1);
    expect(h.hooks.onReady).not.toHaveBeenCalled();
  });

  it('counts a quiet resume as taken after 2 seconds without an error', async () => {
    const h = setup();
    void h.session.start({ greet: false, resume: { session_id: 'sess_1', started_at: 0 } });
    await flush();
    h.socket().open();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(h.hooks.onResumed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.hooks.onResumed).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh session when the server refuses the resume', async () => {
    const h = setup();
    void h.session.start({ greet: false, resume: { session_id: 'sess_1', started_at: 0 } });
    await flush();
    const first = h.socket();
    first.open();
    first.receive({ type: 'session.error', code: 'session_not_found', message: 'gone' });
    await flush();
    const fresh = h.socket();
    expect(fresh).not.toBe(first);
    fresh.open();
    expect(fresh.sent[0]?.type).toBe('session.update');
    fresh.receive({ type: 'session.ready', session_id: 'sess_2' });
    expect(h.hooks.onReady).toHaveBeenCalledTimes(1);
    expect(h.store.session.state.value).toBe('listening');
  });

  it('keeps the 10-minute limit from when the session first started', async () => {
    vi.setSystemTime(1_000_000);
    const h = setup();
    const started = h.session.start({
      greet: false,
      resume: { session_id: 'sess_1', started_at: 1_000_000 - 500_000 },
    });
    await flush();
    const socket = h.socket();
    socket.open();
    socket.receive({ type: 'session.updated' });
    await started;
    await vi.advanceTimersByTimeAsync(39_999);
    expect(socket.types()).not.toContain('reply.create');
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.sent.at(-1)).toEqual({
      type: 'reply.create',
      instructions: COPY.sessionEndingSoon,
    });
  });
});
