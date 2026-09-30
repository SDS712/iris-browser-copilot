/** The browser's audio for one session: a playback context and a capture context. */
import { startCapture, type Capture } from './capture';
import { createPlayback, type Playback } from './playback';

export interface AudioSet {
  readonly playback: Playback;
  /** Starts (or, after the track ended, restarts) the microphone. */
  startCapture(onFrame: (frame: ArrayBuffer) => void, onEnded: () => void): Promise<Capture>;
  /** Both contexts, after the browser suspended them for lack of a click (autoplay). */
  resume(): Promise<void>;
  close(): void;
}

export interface AudioIO {
  /** Creates both contexts. Call it synchronously inside the user action. */
  open(): AudioSet;
}

export function browserAudio(workletUrl: string): AudioIO {
  return {
    open() {
      // Both contexts use the default rate; the worklet resamples to 24 kHz.
      const playbackContext = new AudioContext();
      const captureContext = new AudioContext();
      void playbackContext.resume();
      void captureContext.resume();
      const playback = createPlayback(playbackContext);
      let capture: Capture | null = null;
      return {
        playback,
        async startCapture(onFrame, onEnded) {
          capture?.stop();
          capture = await startCapture(captureContext, workletUrl, onFrame, onEnded);
          return capture;
        },
        async resume() {
          await Promise.all([playbackContext.resume(), captureContext.resume()]);
        },
        close() {
          capture?.stop();
          playback.close();
          void captureContext.close();
        },
      };
    },
  };
}
