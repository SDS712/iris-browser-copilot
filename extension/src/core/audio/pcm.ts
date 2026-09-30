/** PCM helpers shared by the capture worklet, playback and tests. */

/** AssemblyAI's Voice Agent speaks and listens at 24 kHz, 16-bit mono. */
export const WIRE_SAMPLE_RATE = 24_000;
/** 50 ms of audio at 24 kHz. */
export const FRAME_SAMPLES = 1_200;

const BASE64_CHUNK = 0x8000;

/** Float [-1, 1] → 16-bit PCM, clamped. */
export function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function pcm16ToFloat(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = (pcm[i] ?? 0) / 0x8000;
  return out;
}

/**
 * Base64 in 32 KB slices: spreading a whole frame into String.fromCharCode can overflow
 * the stack.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Little-endian 16-bit samples, as AssemblyAI sends them. A trailing odd byte is dropped. */
export function base64ToPcm16(base64: string): Int16Array {
  const bytes = base64ToBytes(base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Int16Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

export function pcm16ToBase64(pcm: Int16Array): string {
  return bytesToBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
}

/**
 * Streaming linear-interpolation resampler. It keeps its position and the last sample
 * between blocks, so a stream of 128-sample blocks resamples without gaps or clicks.
 */
export class LinearResampler {
  private readonly step: number;
  private position = 0;
  private previous = 0;

  constructor(inputRate: number, outputRate: number) {
    this.step = inputRate / outputRate;
  }

  process(input: Float32Array): Float32Array {
    const n = input.length;
    if (n === 0) return new Float32Array(0);
    if (this.step === 1) return input.slice();
    const out = new Float32Array(Math.ceil((n - this.position) / this.step) + 1);
    let written = 0;
    let pos = this.position;
    // Source index 0 is the last sample of the previous block, index k is input[k - 1].
    while (pos < n) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const a = i === 0 ? this.previous : (input[i - 1] ?? 0);
      const b = input[i] ?? 0;
      out[written++] = a + (b - a) * frac;
      pos += this.step;
    }
    this.position = pos - n;
    this.previous = input[n - 1] ?? 0;
    return out.subarray(0, written);
  }
}

/** Collects samples and emits exactly `size`-sample frames. */
export class Framer {
  private buffer: Int16Array;
  private filled = 0;

  constructor(private readonly size: number = FRAME_SAMPLES) {
    this.buffer = new Int16Array(size);
  }

  push(samples: Int16Array, emit: (frame: Int16Array) => void): void {
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(this.size - this.filled, samples.length - offset);
      this.buffer.set(samples.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.size) {
        emit(this.buffer);
        this.buffer = new Int16Array(this.size);
        this.filled = 0;
      }
    }
  }
}
