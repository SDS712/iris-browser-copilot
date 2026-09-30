/** The real voice session over AssemblyAI's Voice Agent WebSocket. */
import { IrisApiError, NETWORK_ERROR, type AgentSession, type IrisApi } from './api';
import type { Capture } from './audio/capture';
import { MicUnavailableError } from './audio/capture';
import type { AudioIO, AudioSet } from './audio/io';
import { startLevelLoop, type LevelSources } from './audio/levels';
import { bytesToBase64 } from './audio/pcm';
import { COPY } from './copy';
import type { VoiceChoice } from './settings';
import {
  parseServerEvent,
  RETRYABLE_ERROR_CODES,
  VOICE_AGENT_URL,
  type ClientEvent,
  type ServerEvent,
  type ToolCallEvent,
} from './protocol';
import {
  addTranscriptLine,
  replaceTranscriptLine,
  type IrisStore,
  type NoticeKind,
  type SessionState,
} from './store';
import { ToolResultQueue } from './tools/result-queue';

export interface StartOptions {
  /** False when started from typed text, a suggestion or a chip. */
  greet: boolean;
  /** Dev harness only: adjusts the session before it's sent (the voice picker). */
  adjustSession?: (session: AgentSession) => AgentSession;
  /** The widget on a new page of the same site: carry on the session from the last page. */
  resume?: SessionHandover;
}

/** A session handed from one page to the next in the same tab. */
export interface SessionHandover {
  session_id: string;
  /** When the session started (ms since the epoch), so the 10-minute limit still holds. */
  started_at: number;
  /** The voice it started with: a fresh session after a refused resume keeps it. */
  voice?: VoiceChoice;
}

/** What the rest of Iris needs from a session. MockVoiceSession implements it too. */
export interface VoiceSessionLike {
  /** True from the start request until the session has ended. */
  readonly isRunning: boolean;
  start(options: StartOptions): Promise<void>;
  end(): Promise<void>;
  /** For pagehide: sends session.end and tears down without waiting. */
  endNow(): void;
  /**
   * For pagehide when the next page of the same site will carry on: tears down without
   * session.end, so the server keeps the session resumable for 30 seconds.
   */
  handOver(): SessionHandover | null;
  sendUserText(text: string): void;
  /**
   * The current page's context for the agent: it goes into the system
   * prompt, replacing the previous page's.
   */
  setPageContext(context: string): void;
  createReply(instructions?: string): void;
  /** The chime before Iris speaks up by itself. */
  playCue(): void;
  submitToolResult(callId: string, result: unknown, isError: boolean): void;
  setMuted(muted: boolean): void;
  resumeAudio(): Promise<void>;
  /** Esc: stops Iris's current audio at once; the rest of that reply isn't played. */
  stopAudio(): void;
  /** The microphone was allowed again: capture again if this session lost it. */
  retryMicrophone(): Promise<void>;
}

export interface SessionHooks {
  /** First session.ready: send the page context. */
  onReady(): void;
  /** A resumed session is live again (after a drop, or on a new page of the same site). */
  onResumed(): void;
  onToolCall(call: ToolCallEvent): void;
  onUserFinal(text: string): void;
  onEnded(): void;
}

export interface SocketLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface SessionDeps {
  api: Pick<IrisApi, 'agentConfig' | 'voiceToken'>;
  store: IrisStore;
  audio: AudioIO;
  hooks: SessionHooks;
  createSocket?: (url: string) => SocketLike;
  startLevels?: (
    sources: LevelSources,
    onLevels: (input: number, output: number) => void,
  ) => () => void;
  /** Debug logging of protocol events (never audio). */
  log?: (direction: 'in' | 'out', type: string, detail?: string) => void;
  wsUrl?: string;
}

const SOCKET_OPEN = 1;
const END_WAIT_MS = 2_000;
const RESUME_WINDOW_MS = 30_000;
/** A short pause before resuming, so the server has seen the old connection go. */
export const RESUME_DELAY_MS = 1_000;
/**
 * AssemblyAI's docs don't say whether session.ready follows a resume. Any other event, or
 * this long without an error, means the session is back.
 */
const RESUME_CONFIRM_MS = 2_000;
/** A resume the server refused: start a fresh session instead (AssemblyAI's own advice). */
const RESUME_REFUSED = new Set(['session_not_found', 'session_forbidden', 'session_expired']);
/** If no reply starts after the user stops talking, go back to listening. */
const THINKING_TIMEOUT_MS = 8_000;

type Phase = 'idle' | 'starting' | 'live' | 'reconnecting';

interface ReplyTrack {
  id: string | null;
  text: string;
  words: { text: string; startMs: number | null }[];
  lineId: number | null;
}

// Agent deltas arrive with or without a leading space; add one only where it belongs.
const ATTACHES_LEFT = /^[.,!?;:%°)\]}…'"’”]/;
const NO_SPACE_AFTER = /[([{$₹\-/'"‘“]$/;

export function appendDelta(text: string, delta: string): string {
  if (!delta) return text;
  if (!text) return delta;
  if (/^\s/.test(delta) || /\s$/.test(text)) return text + delta;
  if (ATTACHES_LEFT.test(delta) || NO_SPACE_AFTER.test(text)) return text + delta;
  return `${text} ${delta}`;
}

function noticeFor(error: unknown): { kind: NoticeKind; message: string } {
  if (error instanceof IrisApiError) {
    if (error.code === 'budget_exhausted_daily') return { kind: 'limit', message: error.message };
    if (error.code === 'service_closed') return { kind: 'closed', message: error.message };
    if (error.code === NETWORK_ERROR) {
      return { kind: 'error', message: COPY.errors.backendUnreachable };
    }
    return { kind: 'error', message: error.message };
  }
  return { kind: 'error', message: COPY.errors.backendUnreachable };
}

export class VoiceSession implements VoiceSessionLike {
  private phase: Phase = 'idle';
  private socket: SocketLike | null = null;
  private ready = false;
  private sessionId: string | null = null;
  private agentSession: AgentSession | null = null;
  private audio: AudioSet | null = null;
  private capture: Capture | null = null;
  private outbox: ClientEvent[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private thinkingTimer: ReturnType<typeof setTimeout> | null = null;
  private stopLevels: (() => void) | null = null;
  private readonly queue: ToolResultQueue;
  private receivedEnded = false;
  private ending = false;
  private resumeUsed = false;
  private retryUsed = false;
  private freshStartUsed = false;
  private timersStarted = false;
  private micRetrying = false;
  private replyActive = false;
  /** Esc stopped this reply's audio: drop its remaining chunks until the next reply. */
  private silenced = false;
  private reply: ReplyTrack | null = null;
  private readonly finishedReplies = new Set<string>();
  private endWaiter: (() => void) | null = null;
  private maxSeconds = 600;
  private startedAt = 0;
  private warnSeconds = 60;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly wsUrl: string;

  constructor(private readonly deps: SessionDeps) {
    this.createSocket = deps.createSocket ?? ((url) => new WebSocket(url));
    this.wsUrl = deps.wsUrl ?? VOICE_AGENT_URL;
    this.queue = new ToolResultQueue((event) => {
      this.send(event);
    });
  }

  get isRunning(): boolean {
    return this.phase !== 'idle';
  }

  private get store() {
    return this.deps.store.session;
  }

  async start(options: StartOptions): Promise<void> {
    if (this.phase !== 'idle') return;
    this.phase = 'starting';
    this.sessionId = options.resume?.session_id ?? null;
    this.startedAt = options.resume?.started_at ?? Date.now();
    this.receivedEnded = false;
    this.ending = false;
    this.resumeUsed = false;
    this.retryUsed = false;
    this.freshStartUsed = false;
    this.timersStarted = false;
    this.deps.store.notice.value = null;
    this.store.spoken.value = [];
    // The voice can't change once the session is established.
    const voice = options.resume?.voice ?? this.deps.store.settings.value.voice;
    this.store.voice.value = voice;
    this.setState('connecting');
    // Created before the first await, while the user's click still counts.
    this.audio = this.deps.audio.open();
    const context = this.audio.playback.context;
    context.onstatechange = () => {
      this.store.audioSuspended.value = this.isRunning && context.state === 'suspended';
    };

    let token: string;
    try {
      const [config, voiceToken] = await Promise.all([
        this.deps.api.agentConfig(options.greet, voice),
        this.deps.api.voiceToken(),
      ]);
      this.agentSession = options.adjustSession
        ? options.adjustSession(config.session)
        : config.session;
      this.maxSeconds = config.max_session_seconds;
      this.warnSeconds = config.warn_before_end_seconds;
      token = voiceToken.token;
    } catch (error) {
      if (!this.isPhase('starting')) return;
      this.finish('idle');
      this.deps.store.notice.value = noticeFor(error);
      return;
    }
    if (!this.isPhase('starting')) return;
    await this.startMicrophone();
    if (!this.isPhase('starting')) return;
    this.store.audioSuspended.value = context.state === 'suspended';
    if (options.resume) {
      // A refused resume starts a fresh session instead (onSessionError).
      this.phase = 'reconnecting';
      this.open(token, true);
      return;
    }
    this.open(token, false);
  }

  private async startMicrophone(): Promise<void> {
    const audio = this.audio;
    if (!audio) return;
    try {
      let started: Capture | null = null;
      const capture = await audio.startCapture(
        (frame) => {
          this.onFrame(frame);
        },
        () => {
          if (started && this.capture === started) this.onMicrophoneLost();
        },
      );
      if (this.phase === 'idle' || this.audio !== audio) {
        // Ended while the permission prompt was open.
        capture.stop();
        return;
      }
      started = capture;
      this.capture = capture;
      capture.setEnabled(!this.store.muted.value);
      this.store.micAvailable.value = true;
      if (this.deps.store.notice.value?.kind === 'mic') this.deps.store.notice.value = null;
    } catch (error) {
      // Typed-only mode: Iris still speaks and reads typed questions.
      this.capture = null;
      this.store.micAvailable.value = false;
      if (error instanceof MicUnavailableError) {
        this.deps.store.notice.value = { kind: 'mic', message: COPY.errors.micBlocked };
      }
    }
  }

  /**
   * The browser ended the track: the permission was taken back (Brave's "until I close
   * this site" lapses once the permission tab closes) or the device went away. The session
   * carries on typed-only until the microphone is allowed again (retryMicrophone).
   */
  private onMicrophoneLost(): void {
    this.capture?.stop();
    this.capture = null;
    this.store.micAvailable.value = false;
    this.deps.store.notice.value = { kind: 'mic', message: COPY.errors.micBlocked };
  }

  async retryMicrophone(): Promise<void> {
    if (this.phase === 'idle' || this.phase === 'starting' || this.capture || this.micRetrying) {
      return;
    }
    this.micRetrying = true;
    try {
      await this.startMicrophone();
    } finally {
      this.micRetrying = false;
    }
  }

  private open(token: string, resume: boolean): void {
    const url = new URL(this.wsUrl);
    url.searchParams.set('token', token);
    const socket = this.createSocket(url.toString());
    this.socket = socket;
    socket.onopen = () => {
      if (socket !== this.socket) return;
      if (resume && this.sessionId) {
        this.sendNow({ type: 'session.resume', session_id: this.sessionId });
        this.timers.push(
          setTimeout(() => {
            if (socket === this.socket) this.onResumeConfirmed();
          }, RESUME_CONFIRM_MS),
        );
      } else if (this.agentSession) {
        this.sendNow({ type: 'session.update', session: this.agentSession });
      }
    };
    socket.onmessage = (message) => {
      if (socket !== this.socket) return;
      const event = parseServerEvent(message.data);
      // Anything but an error (even an event Iris ignores) means a resume was taken.
      if (event?.type !== 'session.error' && event?.type !== 'session.ready') {
        this.onResumeConfirmed();
      }
      if (!event) return;
      if (event.type !== 'reply.audio' && event.type !== 'transcript.agent.delta') {
        this.deps.log?.('in', event.type, 'code' in event ? event.code : undefined);
      }
      this.handle(event);
    };
    socket.onclose = () => {
      this.onSocketClosed(socket);
    };
    socket.onerror = () => {
      // A close event always follows; it decides what happens next.
    };
  }

  /** The server took the resume: it answered with anything but an error. */
  private onResumeConfirmed(): void {
    if (this.phase === 'reconnecting' && this.sessionId) this.onReady(this.sessionId);
  }

  private handle(event: ServerEvent): void {
    switch (event.type) {
      case 'session.ready':
        this.onReady(event.session_id);
        break;
      case 'input.speech.started':
        this.queue.noteEvent('input.speech.started');
        // Barge-in: AssemblyAI's docs stop playback here for the quickest response.
        this.audio?.playback.flush();
        this.store.userLive.value = '';
        this.clearThinkingTimer();
        this.setState('hearing');
        break;
      case 'transcript.user.delta':
        this.store.userLive.value = event.text;
        break;
      case 'input.speech.stopped':
        this.setState('thinking');
        this.armThinkingTimer();
        break;
      case 'transcript.user': {
        this.store.userLive.value = '';
        const text = event.text.trim();
        if (text) {
          addTranscriptLine(this.deps.store, 'you', text);
          this.deps.hooks.onUserFinal(text);
        }
        break;
      }
      case 'reply.started':
        this.silenced = false;
        this.queue.noteEvent('reply.started');
        this.clearThinkingTimer();
        this.replyActive = true;
        this.store.toolCaption.value = null;
        this.startReply(event.reply_id);
        this.audio?.playback.beginReply();
        this.setState('speaking');
        break;
      case 'reply.audio':
        if (!this.silenced) this.audio?.playback.enqueue(event.data);
        break;
      case 'transcript.agent.delta':
        this.onAgentDelta(event.reply_id, event.delta, event.start_ms);
        break;
      case 'transcript.agent':
        this.onAgentFinal(event.reply_id, event.text);
        break;
      case 'reply.done':
        this.onReplyDone(event.status === 'interrupted');
        break;
      case 'tool.call':
        this.queue.started(event.call_id);
        this.clearThinkingTimer();
        this.setState('thinking');
        this.deps.hooks.onToolCall(event);
        break;
      case 'session.error':
        this.onSessionError(event.code);
        break;
      case 'session.ended':
        this.receivedEnded = true;
        this.endWaiter?.();
        break;
    }
  }

  private onReady(sessionId: string): void {
    const first = this.sessionId === null;
    this.sessionId = sessionId;
    this.ready = true;
    this.phase = 'live';
    if (!this.timersStarted) this.startSessionTimers();
    this.stopLevels ??= (this.deps.startLevels ?? startLevelLoop)(
      {
        input: () => this.capture?.analyser ?? null,
        output: () => this.audio?.playback.analyser ?? null,
      },
      (input, output) => {
        this.store.inputLevel.value = input;
        this.store.outputLevel.value = output;
      },
    );
    this.setState('listening');
    // A resumed session keeps its conversation and settings, so the page context isn't sent
    // again. It goes before anything queued, so a question typed while connecting sees it.
    if (first) this.deps.hooks.onReady();
    else this.deps.hooks.onResumed();
    const queued = this.outbox;
    this.outbox = [];
    for (const event of queued) this.sendNow(event);
  }

  private startReply(replyId: string | null): void {
    this.reply = { id: replyId, text: '', words: [], lineId: null };
    this.store.agentLive.value = '';
  }

  private onAgentDelta(replyId: string | null, delta: string, startMs: number | null): void {
    if (replyId && this.finishedReplies.has(replyId) && this.reply?.id !== replyId) return;
    if (!this.reply || (replyId && this.reply.id !== replyId)) this.startReply(replyId);
    const reply = this.reply;
    if (!reply) return;
    reply.words.push({ text: delta, startMs });
    reply.text = appendDelta(reply.text, delta);
    // The caption follows the words as they arrive, even after the final line is in.
    this.store.agentLive.value = reply.text;
  }

  private onAgentFinal(replyId: string | null, text: string): void {
    if (replyId && this.finishedReplies.has(replyId)) return;
    const line = text.trim();
    if (!line) return;
    if (!this.reply || (replyId && this.reply.id !== replyId)) this.startReply(replyId);
    const reply = this.reply;
    if (!reply) return;
    reply.lineId = addTranscriptLine(this.deps.store, 'iris', line);
    this.store.spoken.value = [...this.store.spoken.value, line];
    if (replyId) this.finishedReplies.add(replyId);
  }

  private onReplyDone(interrupted: boolean): void {
    this.replyActive = false;
    const flushed = this.queue.noteEvent('reply.done', interrupted);
    if (interrupted) {
      this.audio?.playback.flush();
      this.trimInterruptedReply();
      this.store.agentLive.value = '';
      this.setState('hearing');
      return;
    }
    if (flushed || this.queue.hasWork) {
      // Tool results went out (or are still running): the agent replies again next.
      this.setState('thinking');
      return;
    }
    this.settleWhenQuiet();
  }

  /** Back to listening once Iris's audio has finished playing. */
  private settleWhenQuiet(): void {
    const playback = this.audio?.playback;
    if (!playback || playback.isIdle()) {
      this.store.agentLive.value = '';
      this.setState('listening');
      return;
    }
    const stop = playback.onIdle(() => {
      stop();
      if (this.replyActive || !this.isRunning) return;
      if (this.store.state.value === 'speaking') {
        this.store.agentLive.value = '';
        this.setState('listening');
      }
    });
  }

  /** Cuts Iris's transcript line back to the words actually heard. */
  private trimInterruptedReply(): void {
    const reply = this.reply;
    if (!reply) return;
    const heardMs = this.audio?.playback.replyElapsedMs() ?? 0;
    let heard = '';
    let cut = false;
    for (const word of reply.words) {
      if (word.startMs !== null && word.startMs > heardMs) {
        cut = true;
        break;
      }
      heard = appendDelta(heard, word.text);
    }
    const text = cut ? `${heard.trim()}…` : heard.trim();
    if (reply.lineId !== null) {
      if (cut) replaceTranscriptLine(this.deps.store, reply.lineId, text);
    } else if (heard.trim()) {
      addTranscriptLine(this.deps.store, 'iris', text);
    }
    if (reply.id) this.finishedReplies.add(reply.id);
    this.reply = null;
  }

  private onSessionError(code: string): void {
    if (this.phase === 'reconnecting') {
      if (RESUME_REFUSED.has(code) && this.sessionId && !this.freshStartUsed) {
        // The conversation so far is gone on the server; carry on in a new session, with
        // no second greeting. onReady sends the page context again.
        this.freshStartUsed = true;
        this.sessionId = null;
        if (this.agentSession) this.agentSession = { ...this.agentSession, greeting: undefined };
        void this.reconnect(Date.now());
        return;
      }
      this.fail();
      return;
    }
    if (RETRYABLE_ERROR_CODES.has(code) && !this.retryUsed) {
      this.retryUsed = true;
      void this.reconnect(Date.now());
      return;
    }
    this.fail();
  }

  private onSocketClosed(socket: SocketLike): void {
    if (socket !== this.socket) return;
    this.socket = null;
    this.ready = false;
    this.endWaiter?.();
    if (this.phase === 'idle') return;
    if (this.receivedEnded || this.ending) {
      this.finish('idle');
      return;
    }
    if (this.phase === 'live' && this.sessionId && !this.resumeUsed) {
      this.resumeUsed = true;
      void this.reconnect(Date.now());
      return;
    }
    this.fail();
  }

  /**
   * One new connection with a new token: a resume if the session was ready, otherwise a
   * fresh start with the same session settings.
   */
  private async reconnect(lostAt: number): Promise<void> {
    this.phase = 'reconnecting';
    this.ready = false;
    const old = this.socket;
    this.socket = null;
    if (old) {
      old.onclose = null;
      old.onmessage = null;
      if (old.readyState === SOCKET_OPEN) old.close();
    }
    this.setState('connecting');
    try {
      if (this.sessionId) await new Promise((resolve) => setTimeout(resolve, RESUME_DELAY_MS));
      if (!this.isPhase('reconnecting')) return;
      const { token } = await this.deps.api.voiceToken();
      if (!this.isPhase('reconnecting')) return;
      if (this.sessionId && Date.now() - lostAt > RESUME_WINDOW_MS) {
        this.fail();
        return;
      }
      this.open(token, this.sessionId !== null);
    } catch {
      if (this.isPhase('reconnecting')) this.fail();
    }
  }

  private fail(): void {
    this.finish('error');
  }

  async end(): Promise<void> {
    if (this.phase === 'idle') return;
    this.ending = true;
    const socket = this.socket;
    if (socket && socket.readyState === SOCKET_OPEN) {
      this.sendNow({ type: 'session.end' });
      if (!this.receivedEnded) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, END_WAIT_MS);
          this.endWaiter = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        this.endWaiter = null;
      }
    }
    this.finish('idle');
  }

  handOver(): SessionHandover | null {
    if (this.phase !== 'live' || !this.sessionId) return null;
    const handover: SessionHandover = {
      session_id: this.sessionId,
      started_at: this.startedAt,
      voice: this.store.voice.value ?? undefined,
    };
    // Left open: the browser closes it as the page goes ("going away"), a drop the server
    // keeps resumable, where a clean close from here may count as the end.
    const socket = this.socket;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
    }
    this.socket = null;
    this.finish('idle');
    return handover;
  }

  endNow(): void {
    if (this.phase === 'idle') return;
    this.ending = true;
    if (this.socket?.readyState === SOCKET_OPEN) this.sendNow({ type: 'session.end' });
    this.finish('idle');
  }

  /** Tears everything down. Safe to call more than once. */
  private finish(state: SessionState): void {
    if (this.phase === 'idle') return;
    this.phase = 'idle';
    this.ready = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.clearThinkingTimer();
    this.stopLevels?.();
    this.stopLevels = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      if (socket.readyState === SOCKET_OPEN) socket.close();
    }
    this.audio?.close();
    this.audio = null;
    this.capture = null;
    this.queue.reset();
    this.outbox = [];
    this.replyActive = false;
    this.reply = null;
    this.store.toolCaption.value = null;
    this.store.userLive.value = '';
    this.store.agentLive.value = '';
    this.store.audioSuspended.value = false;
    this.store.voice.value = null;
    this.setState(state);
    this.deps.hooks.onEnded();
  }

  /** Counted from the session's start, which for a handed-over session was pages ago. */
  private startSessionTimers(): void {
    this.timersStarted = true;
    const elapsed = Date.now() - this.startedAt;
    const warnAt = Math.max(0, (this.maxSeconds - this.warnSeconds) * 1000 - elapsed);
    this.timers.push(
      setTimeout(() => {
        this.createReply(COPY.sessionEndingSoon);
      }, warnAt),
      setTimeout(
        () => {
          void this.end().then(() => {
            this.deps.store.notice.value = { kind: 'timeout', message: COPY.errors.timedOut };
          });
        },
        Math.max(0, this.maxSeconds * 1000 - elapsed),
      ),
    );
  }

  private armThinkingTimer(): void {
    this.clearThinkingTimer();
    this.thinkingTimer = setTimeout(() => {
      this.thinkingTimer = null;
      if (this.store.state.value === 'thinking' && !this.queue.hasWork) this.setState('listening');
    }, THINKING_TIMEOUT_MS);
  }

  private clearThinkingTimer(): void {
    if (this.thinkingTimer !== null) clearTimeout(this.thinkingTimer);
    this.thinkingTimer = null;
  }

  private onFrame(frame: ArrayBuffer): void {
    if (!this.ready || this.store.muted.value) return;
    if (this.socket?.readyState !== SOCKET_OPEN) return;
    this.socket.send(
      JSON.stringify({ type: 'input.audio', audio: bytesToBase64(new Uint8Array(frame)) }),
    );
  }

  /** Sends now if the session is ready; otherwise holds the event until it is. */
  private send(event: ClientEvent): void {
    if (this.ready) this.sendNow(event);
    else if (this.phase !== 'idle') this.outbox.push(event);
  }

  private sendNow(event: ClientEvent): void {
    const socket = this.socket;
    if (socket?.readyState !== SOCKET_OPEN) return;
    this.deps.log?.('out', event.type);
    socket.send(JSON.stringify(event));
  }

  sendUserText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    addTranscriptLine(this.deps.store, 'you', trimmed);
    if (this.phase === 'idle') void this.start({ greet: false });
    // AssemblyAI accepts conversation.message, but the agent never sees it: checked against
    // the live API on 2026-09-28. One-shot reply instructions do reach it.
    this.createReply(COPY.typed(trimmed));
  }

  setPageContext(context: string): void {
    const base = this.agentSession?.system_prompt;
    if (!base) return;
    this.send({ type: 'session.update', session: { system_prompt: `${base}\n\n${context}` } });
  }

  createReply(instructions?: string): void {
    this.send(instructions ? { type: 'reply.create', instructions } : { type: 'reply.create' });
  }

  submitToolResult(callId: string, result: unknown, isError: boolean): void {
    if (!this.isRunning) return;
    this.queue.push(callId, result, isError);
  }

  stopAudio(): void {
    if (!this.isPhase('live') || this.store.state.value !== 'speaking') return;
    this.silenced = true;
    this.audio?.playback.flush();
    this.trimInterruptedReply();
    this.store.agentLive.value = '';
    this.setState('listening');
  }

  setMuted(muted: boolean): void {
    this.store.muted.value = muted;
    this.capture?.setEnabled(!muted);
    const state = this.store.state.value;
    if (state === 'listening' || state === 'muted') this.setState('listening');
  }

  playCue(): void {
    if (!this.audio || this.phase === 'idle') return;
    this.audio.playback.chime();
    this.store.cues.value += 1;
  }

  async resumeAudio(): Promise<void> {
    const audio = this.audio;
    if (!audio) return;
    await audio.resume();
    this.store.audioSuspended.value = audio.playback.context.state === 'suspended';
  }

  /** Re-reads the phase after an await, where it may have changed. */
  private isPhase(phase: Phase): boolean {
    return this.phase === phase;
  }

  private setState(state: SessionState): void {
    this.store.state.value = state === 'listening' && this.store.muted.value ? 'muted' : state;
  }
}
