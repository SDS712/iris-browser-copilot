/** Fails when iris-widget.js is over its budget: 90 KB gzipped. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET = 90 * 1024;
const file = join(import.meta.dirname, '..', 'dist-widget', 'iris-widget.js');
const source = await readFile(file);
const gzipped = gzipSync(source, { level: 9 }).length;
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
console.log(`iris-widget.js: ${kb(source.length)}, ${kb(gzipped)} gzipped (budget ${kb(BUDGET)})`);
if (gzipped > BUDGET) {
  console.error('Over the size budget.');
  process.exit(1);
}
