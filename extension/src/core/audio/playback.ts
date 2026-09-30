/** Playback of Iris's voice: each chunk scheduled right after the previous one. */
import { base64ToPcm16, pcm16ToFloat, WIRE_SAMPLE_RATE } from './pcm';

/** Lead time when the queue has run dry, so the first chunk doesn't start mid-render. */
const START_LEAD_S = 0.04;

// The chime before Iris speaks up by itself: E5 then A5, soft and short.
const CHIME_NOTES_HZ = [659.25, 880];
const CHIME_NOTE_S = 0.11;
const CHIME_FADE_S = 0.02;
const CHIME_GAIN = 0.12;
/** A breath between the chime and the words. */
const CHIME_GAP_S = 0.08;

export interface Playback {
  readonly context: AudioContext;
  readonly analyser: AnalyserNode;
  enqueue(base64: string): void;
  /** Stops everything scheduled at once (interruption, Esc). */
  flush(): void;
  isIdle(): boolean;
  /** Called whenever the last scheduled chunk finishes or is flushed. */
  onIdle(callback: () => void): () => void;
  /** The next chunk marks the start of a new reply, for trimming interrupted lines. */
  beginReply(): void;
  /** Milliseconds of the current reply heard so far. */
  replyElapsedMs(): number;
  /** Two soft notes, queued so the next chunk of speech starts after them. */
  chime(): void;
  close(): void;
}

export function createPlayback(context: AudioContext = new AudioContext()): Playback {
  const gain = context.createGain();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  gain.connect(analyser);
  analyser.connect(context.destination);

  const sources = new Set<AudioBufferSourceNode>();
  const idleCallbacks = new Set<() => void>();
  let playHead = 0;
  let replyStart: number | null = null;
  let replyPending = false;

  const notifyIdle = () => {
    for (const callback of idleCallbacks) callback();
  };

  return {
    context,
    analyser,
    enqueue(base64) {
      const samples = pcm16ToFloat(base64ToPcm16(base64));
      if (samples.length === 0) return;
      const buffer = context.createBuffer(1, samples.length, WIRE_SAMPLE_RATE);
      buffer.getChannelData(0).set(samples);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      const now = context.currentTime;
      const startAt = sources.size === 0 ? Math.max(playHead, now + START_LEAD_S) : playHead;
      if (replyPending) {
        replyStart = startAt;
        replyPending = false;
      }
      source.onended = () => {
        sources.delete(source);
        if (sources.size === 0) notifyIdle();
      };
      sources.add(source);
      source.start(startAt);
      playHead = startAt + buffer.duration;
    },
    flush() {
      const hadAudio = sources.size > 0;
      for (const source of sources) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      }
      sources.clear();
      playHead = context.currentTime;
      if (hadAudio) notifyIdle();
    },
    isIdle: () => sources.size === 0,
    onIdle(callback) {
      idleCallbacks.add(callback);
      return () => idleCallbacks.delete(callback);
    },
    beginReply() {
      replyPending = true;
      replyStart = null;
    },
    replyElapsedMs() {
      if (replyStart === null) return 0;
      return Math.max(0, (context.currentTime - replyStart) * 1000);
    },
    chime() {
      const start = Math.max(playHead, context.currentTime + START_LEAD_S);
      CHIME_NOTES_HZ.forEach((frequency, index) => {
        const at = start + index * CHIME_NOTE_S;
        const tone = context.createOscillator();
        tone.type = 'sine';
        tone.frequency.value = frequency;
        const envelope = context.createGain();
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(CHIME_GAIN, at + CHIME_FADE_S);
        envelope.gain.setValueAtTime(CHIME_GAIN, at + CHIME_NOTE_S - CHIME_FADE_S);
        envelope.gain.linearRampToValueAtTime(0, at + CHIME_NOTE_S);
        tone.connect(envelope);
        envelope.connect(gain);
        tone.start(at);
        tone.stop(at + CHIME_NOTE_S);
      });
      playHead = start + CHIME_NOTES_HZ.length * CHIME_NOTE_S + CHIME_GAP_S;
    },
    close() {
      this.flush();
      idleCallbacks.clear();
      void context.close();
    },
  };
}
