/**
 * AudioWorklet that turns microphone audio into 24 kHz 16-bit PCM in 50 ms frames
 *. Built as a separate file: worklet modules can't share the page bundle.
 */
import { floatToPcm16, Framer, LinearResampler, WIRE_SAMPLE_RATE } from '../core/audio/pcm';

// The AudioWorkletGlobalScope isn't in TypeScript's DOM library.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(
  name: string,
  processor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;
declare const sampleRate: number;

interface CaptureOptions {
  inputSampleRate?: number;
  targetSampleRate?: number;
}

class IrisPcmCapture extends AudioWorkletProcessor {
  private readonly resampler: LinearResampler;
  private readonly framer = new Framer();

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    const settings = (options.processorOptions ?? {}) as CaptureOptions;
    this.resampler = new LinearResampler(
      settings.inputSampleRate ?? sampleRate,
      settings.targetSampleRate ?? WIRE_SAMPLE_RATE,
    );
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) {
      this.framer.push(floatToPcm16(this.resampler.process(channel)), (frame) => {
        this.port.postMessage(frame.buffer, [frame.buffer]);
      });
    }
    return true;
  }
}

registerProcessor('iris-pcm-capture', IrisPcmCapture);
