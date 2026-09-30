/** Microphone capture: default-rate context, resampled to 24 kHz in the worklet. */
import { WIRE_SAMPLE_RATE } from './pcm';

export class MicUnavailableError extends Error {
  constructor(readonly denied: boolean) {
    super(denied ? 'Microphone permission denied' : 'Microphone unavailable');
    this.name = 'MicUnavailableError';
  }
}

export interface Capture {
  readonly analyser: AnalyserNode;
  setEnabled(enabled: boolean): void;
  stop(): void;
}

/** Contexts that already have the worklet: a capture restarted on one doesn't add it twice. */
const workletLoaded = new WeakSet<BaseAudioContext>();

/**
 * Starts capture on a context created earlier, inside the user's click, so browsers
 * that need a gesture let it run. Frames are 1,200-sample PCM16 buffers. `onEnded` runs
 * if the browser ends the track (the permission was taken back, or the device went away).
 */
export async function startCapture(
  context: AudioContext,
  workletUrl: string,
  onFrame: (frame: ArrayBuffer) => void,
  onEnded: () => void,
): Promise<Capture> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Echo cancellation must stay on; AssemblyAI advises against noise suppression.
      audio: { echoCancellation: true, noiseSuppression: false, channelCount: 1 },
    });
  } catch (error) {
    const denied = error instanceof DOMException && error.name === 'NotAllowedError';
    throw new MicUnavailableError(denied);
  }
  try {
    if (!workletLoaded.has(context)) {
      await context.audioWorklet.addModule(workletUrl);
      workletLoaded.add(context);
    }
    const source = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, 'iris-pcm-capture', {
      processorOptions: { inputSampleRate: context.sampleRate, targetSampleRate: WIRE_SAMPLE_RATE },
    });
    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      onFrame(event.data);
    };
    source.connect(worklet);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', onEnded);
    return {
      analyser,
      setEnabled(enabled) {
        for (const track of stream.getAudioTracks()) track.enabled = enabled;
      },
      stop() {
        worklet.port.onmessage = null;
        source.disconnect();
        for (const track of stream.getTracks()) {
          track.removeEventListener('ended', onEnded);
          track.stop();
        }
      },
    };
  } catch {
    for (const track of stream.getTracks()) track.stop();
    throw new MicUnavailableError(false);
  }
}
