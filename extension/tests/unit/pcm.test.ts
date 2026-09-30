import { describe, expect, it } from 'vitest';
import { rms, smoothLevel } from '../../src/core/audio/levels';
import {
  base64ToPcm16,
  bytesToBase64,
  floatToPcm16,
  Framer,
  FRAME_SAMPLES,
  LinearResampler,
  pcm16ToBase64,
  pcm16ToFloat,
} from '../../src/core/audio/pcm';

function resampleInBlocks(inputRate: number, seconds: number): number {
  const resampler = new LinearResampler(inputRate, 24_000);
  const total = inputRate * seconds;
  let produced = 0;
  for (let offset = 0; offset < total; offset += 128) {
    const block = new Float32Array(Math.min(128, total - offset));
    produced += resampler.process(block).length;
  }
  return produced;
}

describe('PCM16 conversion', () => {
  it('clamps to the 16-bit range', () => {
    const pcm = floatToPcm16(new Float32Array([1.5, -1.5, 1, -1, 0, 0.5, -0.5]));
    expect(Array.from(pcm)).toEqual([32767, -32768, 32767, -32768, 0, 16383, -16384]);
  });

  it('converts back to floats in [-1, 1)', () => {
    const floats = pcm16ToFloat(new Int16Array([-32768, 0, 16384]));
    expect(Array.from(floats)).toEqual([-1, 0, 0.5]);
  });
});

describe('base64', () => {
  it('round-trips PCM16 exactly, including large buffers', () => {
    const pcm = new Int16Array(200_000);
    for (let i = 0; i < pcm.length; i++) pcm[i] = ((i * 7919) % 65536) - 32768;
    const back = base64ToPcm16(pcm16ToBase64(pcm));
    expect(back).toEqual(pcm);
  });

  it('encodes a megabyte without overflowing the stack', () => {
    expect(() => bytesToBase64(new Uint8Array(1_048_576))).not.toThrow();
  });

  it('reads little-endian samples', () => {
    expect(Array.from(base64ToPcm16(btoa('\x01\x00\xff\xff')))).toEqual([1, -1]);
  });
});

describe('resampling to 24 kHz', () => {
  it('turns one second at 48 kHz into 24,000 samples', () => {
    expect(Math.abs(resampleInBlocks(48_000, 1) - 24_000)).toBeLessThanOrEqual(1);
  });

  it('turns one second at 44.1 kHz into 24,000 samples', () => {
    expect(Math.abs(resampleInBlocks(44_100, 1) - 24_000)).toBeLessThanOrEqual(1);
  });

  it('passes 24 kHz through unchanged', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(Array.from(new LinearResampler(24_000, 24_000).process(input))).toEqual(
      Array.from(input),
    );
  });

  it('keeps a sine wave continuous across blocks', () => {
    const rate = 48_000;
    const resampler = new LinearResampler(rate, 24_000);
    const out: number[] = [];
    for (let offset = 0; offset < rate / 10; offset += 128) {
      const block = new Float32Array(128);
      for (let i = 0; i < 128; i++) block[i] = Math.sin((2 * Math.PI * 440 * (offset + i)) / rate);
      out.push(...resampler.process(block));
    }
    // Output sample k sits at input position 2k - 1 (one sample of history at the start).
    for (let k = 1; k < out.length; k++) {
      const expected = Math.sin((2 * Math.PI * 440 * (2 * k - 1)) / rate);
      expect(Math.abs((out[k] ?? 0) - expected)).toBeLessThan(0.01);
    }
  });
});

describe('50 ms framing', () => {
  it('emits exactly 1,200-sample frames and keeps the rest', () => {
    const framer = new Framer();
    const frames: Int16Array[] = [];
    const source = new Int16Array(3_000).map((_, i) => i % 1000);
    for (let offset = 0; offset < source.length; offset += 37) {
      framer.push(source.subarray(offset, offset + 37), (frame) => frames.push(frame));
    }
    expect(frames).toHaveLength(2);
    expect(frames.every((frame) => frame.length === FRAME_SAMPLES)).toBe(true);
    expect(Array.from(frames[1] ?? [])).toEqual(Array.from(source.subarray(1200, 2400)));
  });
});

describe('levels', () => {
  it('computes RMS', () => {
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rms(new Float32Array(0))).toBe(0);
  });

  it('smooths towards the new level over about 80 ms', () => {
    expect(smoothLevel(0, 1, 80)).toBeCloseTo(1 - Math.exp(-1));
    expect(smoothLevel(0, 1, 0)).toBe(0);
    expect(smoothLevel(0, 1, 800)).toBeGreaterThan(0.99);
  });
});
