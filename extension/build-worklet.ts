import { join } from 'node:path';
import { build, type Rolldown } from 'vite';

/** The capture worklet's source. */
export const WORKLET_ENTRY = join(import.meta.dirname, 'src', 'widget', 'pcm-worklet.ts');

/**
 * Bundles the worklet into one plain script. An AudioWorklet module must be its own file,
 * and dev-server extras (HMR, Preact refresh) can't run in the worklet scope.
 */
export async function buildWorklet(): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: true,
      lib: { entry: WORKLET_ENTRY, formats: ['es'], fileName: 'pcm-worklet' },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const chunk = outputs.flatMap((output) => output.output).find((item) => item.type === 'chunk');
  if (!chunk) throw new Error('The worklet build produced no script');
  return chunk.code;
}
