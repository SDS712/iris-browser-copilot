/**
 * Builds dist-widget/: iris-widget.js as one IIFE with its CSS
 * inlined, pcm-worklet.js next to it, and the Inter files in fonts/.
 */
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import preact from '@preact/preset-vite';
import { build } from 'vite';
import { buildWorklet } from '../build-worklet.ts';
import { FONT_FILES } from '../src/ui/fonts.ts';

const root = join(import.meta.dirname, '..');
const outDir = join(root, 'dist-widget');
const fontsDir = join(root, 'node_modules', '@fontsource', 'inter', 'files');

await rm(outDir, { recursive: true, force: true });
await build({
  configFile: false,
  root,
  logLevel: 'warn',
  // The extension's public/ (icons) isn't part of the widget.
  publicDir: false,
  plugins: [preact()],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    lib: {
      entry: join(root, 'src', 'widget', 'widget.ts'),
      name: 'IrisWidget',
      formats: ['iife'],
      fileName: () => 'iris-widget.js',
    },
  },
});
await writeFile(join(outDir, 'pcm-worklet.js'), await buildWorklet());
await mkdir(join(outDir, 'fonts'), { recursive: true });
for (const file of FONT_FILES) await copyFile(join(fontsDir, file), join(outDir, 'fonts', file));
console.log(`Built ${outDir}`);
