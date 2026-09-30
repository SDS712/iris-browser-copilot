/** Input and output levels for the orb: RMS, smoothed over about 80 ms. */

export const LEVEL_SMOOTHING_MS = 80;

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

/** Exponential smoothing with a time constant, so the result doesn't depend on frame rate. */
export function smoothLevel(previous: number, next: number, elapsedMs: number): number {
  const alpha = 1 - Math.exp(-Math.max(elapsedMs, 0) / LEVEL_SMOOTHING_MS);
  return previous + (next - previous) * alpha;
}

/** Reads an analyser's current RMS level, scaled to roughly 0–1 for speech. */
export function readLevel(analyser: AnalyserNode, scratch: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(scratch);
  return Math.min(1, rms(scratch) * 4);
}

export interface LevelSources {
  input(): AnalyserNode | null;
  output(): AnalyserNode | null;
}

/**
 * Updates the two levels once per animation frame until stopped. Levels decay to zero
 * when a source goes away.
 */
export function startLevelLoop(
  sources: LevelSources,
  onLevels: (input: number, output: number) => void,
): () => void {
  let frame = 0;
  let last = performance.now();
  let input = 0;
  let output = 0;
  const scratch = new Float32Array(1024);
  const tick = (now: number) => {
    const elapsed = now - last;
    last = now;
    const inNode = sources.input();
    const outNode = sources.output();
    input = smoothLevel(input, inNode ? readLevel(inNode, scratch) : 0, elapsed);
    output = smoothLevel(output, outNode ? readLevel(outNode, scratch) : 0, elapsed);
    onLevels(input, output);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    onLevels(0, 0);
  };
}
