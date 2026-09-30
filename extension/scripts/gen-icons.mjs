// Renders the extension icons from the glyph. Needs `rsvg-convert`
// (librsvg); the PNGs are committed, so this only runs when the glyph changes.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const outDir = join(root, 'public', 'icon');
mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  // The highlight dot is dropped below 24 px.
  const source = size < 24 ? 'iris-glyph-small.svg' : 'iris-glyph.svg';
  execFileSync('rsvg-convert', [
    '-w',
    String(size),
    '-h',
    String(size),
    '-o',
    join(outDir, `${size}.png`),
    join(root, 'assets', source),
  ]);
}
console.log(`Icons written to ${outDir}`);
