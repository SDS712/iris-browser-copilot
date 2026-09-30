/**
 * Mock voice: the same interface as VoiceSession, with no
 * microphone, no WebSocket and nothing sent to AssemblyAI. Typed questions go to a fake
 * agent that calls ask_page; say lines are "spoken" as a live caption for about 3 seconds.
 */
import type { SessionHandover, SessionHooks, StartOptions, VoiceSessionLike } from './session';
import { addTranscriptLine, type IrisStore } from './store';

const CONNECT_MS = 300;
/** What the real agent is told these mean during a walkthrough (system prompt). */
const WALK_WORDS: Record<string, string | undefined> = {
  next: 'next',
  'go on': 'next',
  back: 'back',
  again: 'repeat',
  repeat: 'repeat',
  stop: 'stop',
};
const WALK_START_RE = /\b(walk|take) me through\b/;
/** "Guide me in filling this form": a form walkthrough. */
const FORM_GUIDE_RE =
  /\b(guide|help) me (in |with |through )?(filling|fill|complete|completing)\b|\bthrough this form\b/;
const SPEAK_MS = 3_000;

/** Pulls the line to speak out of reply.create instructions (`… "<say>"`). */
export function quotedLine(instructions: string): string | null {
  const match = /"([^"]+)"\s*$/.exec(instructions.trim());
  return match?.[1] ?? null;
}

function sayOf(result: unknown, isError: boolean): string | null {
  if (typeof result !== 'object' || result === null) return null;
  const value = (result as Record<string, unknown>)[isError ? 'error' : 'say'];
  return typeof value === 'string' && value.trim() ? value : null;
}

export class MockVoiceSession implements VoiceSessionLike {
  private running = false;
  private ready = false;
  private calls = 0;
  private pendingQuestions: string[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private speakQueue: string[] = [];
  private speaking = false;
  private startedAt = 0;

  constructor(private readonly deps: { store: IrisStore; hooks: SessionHooks }) {}

  get isRunning(): boolean {
    return this.running;
  }

  private get session() {
    return this.deps.store.session;
  }

  start(options: StartOptions): Promise<void> {
    if (this.running) return Promise.resolve();
    this.running = true;
    this.startedAt = options.resume?.started_at ?? Date.now();
    this.deps.store.notice.value = null;
    this.session.spoken.value = [];
    this.session.voice.value = options.resume?.voice ?? this.deps.store.settings.value.voice;
    this.session.state.value = 'connecting';
    return new Promise((resolve) => {
      this.later(() => {
        this.ready = true;
        this.setListening();
        if (options.resume) this.deps.hooks.onResumed();
        else this.deps.hooks.onReady();
        const questions = this.pendingQuestions;
        this.pendingQuestions = [];
        for (const question of questions) this.askAgent(question);
        resolve();
      }, CONNECT_MS);
    });
  }

  end(): Promise<void> {
    this.endNow();
    return Promise.resolve();
  }

  handOver(): SessionHandover | null {
    if (!this.ready) return null;
    const handover: SessionHandover = {
      session_id: 'mock-session',
      started_at: this.startedAt,
      voice: this.session.voice.value ?? undefined,
    };
    this.endNow();
    return handover;
  }

  endNow(): void {
    if (!this.running) return;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.running = false;
    this.ready = false;
    this.speaking = false;
    this.speakQueue = [];
    this.pendingQuestions = [];
    this.session.agentLive.value = '';
    this.session.toolCaption.value = null;
    this.session.voice.value = null;
    this.session.state.value = 'idle';
    this.deps.hooks.onEnded();
  }

  sendUserText(text: string): void {
    const question = text.trim();
    if (!question) return;
    addTranscriptLine(this.deps.store, 'you', question);
    if (this.ready) {
      this.askAgent(question);
      return;
    }
    this.pendingQuestions.push(question);
    if (!this.running) void this.start({ greet: false });
  }

  setPageContext(_context: string): void {
    // The fake agent doesn't read context.
  }

  createReply(instructions?: string): void {
    const line = instructions ? quotedLine(instructions) : null;
    if (line) this.speak(line);
  }

  submitToolResult(_callId: string, result: unknown, isError: boolean): void {
    if (!this.running) return;
    const line = sayOf(result, isError);
    if (line) this.speak(line);
    else if (!this.speaking) this.setListening();
  }

  setMuted(muted: boolean): void {
    this.session.muted.value = muted;
    if (this.ready && !this.speaking) this.setListening();
  }

  resumeAudio(): Promise<void> {
    return Promise.resolve();
  }

  /** No audio in mock voice: the cue is only counted, so tests can see it. */
  playCue(): void {
    if (this.running) this.session.cues.value += 1;
  }

  retryMicrophone(): Promise<void> {
    return Promise.resolve();
  }

  stopAudio(): void {
    if (!this.speaking) return;
    this.speakQueue = [];
    this.speaking = false;
    this.session.agentLive.value = '';
    this.setListening();
  }

  /** The fake agent: every typed question becomes an ask_page call. */
  /** The fake agent: a walkthrough word drives the walkthrough; anything else is ask_page. */
  private askAgent(question: string): void {
    this.calls += 1;
    this.session.state.value = 'thinking';
    const word = question
      .trim()
      .toLowerCase()
      .replace(/[.!?]+$/, '');
    const form = FORM_GUIDE_RE.test(word);
    const action = WALK_WORDS[word] ?? (form || WALK_START_RE.test(word) ? 'start' : null);
    this.deps.hooks.onToolCall({
      type: 'tool.call',
      call_id: `mock-call-${this.calls}`,
      name: action ? 'walk_through' : 'ask_page',
      arguments: action ? (form ? { action, mode: 'form' } : { action }) : { question },
    });
  }

  private speak(line: string): void {
    if (this.speaking) {
      this.speakQueue.push(line);
      return;
    }
    this.speaking = true;
    this.session.toolCaption.value = null;
    this.session.state.value = 'speaking';
    this.session.agentLive.value = line;
    this.session.spoken.value = [...this.session.spoken.value, line];
    addTranscriptLine(this.deps.store, 'iris', line);
    this.later(() => {
      this.speaking = false;
      this.session.agentLive.value = '';
      const next = this.speakQueue.shift();
      if (next) this.speak(next);
      else this.setListening();
    }, SPEAK_MS);
  }

  private setListening(): void {
    this.session.state.value = this.session.muted.value ? 'muted' : 'listening';
  }

  private later(callback: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== timer);
      callback();
    }, ms);
    this.timers.push(timer);
  }
}
