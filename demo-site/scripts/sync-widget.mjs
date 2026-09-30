// Copies the widget (extension/dist-widget) into public/widget/, building it first if
// needed, and the newest extension zip into public/downloads/ when one exists.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const extension = join(root, '..', 'extension');
const built = join(extension, 'dist-widget');
const widgetDir = join(root, 'public', 'widget');
const downloads = join(root, 'public', 'downloads');

if (!existsSync(join(built, 'iris-widget.js'))) {
  console.log('Building the widget (pnpm --filter extension build:widget)…');
  execFileSync('pnpm', ['--filter', 'extension', 'build:widget'], { stdio: 'inherit', cwd: root });
}
rmSync(widgetDir, { recursive: true, force: true });
cpSync(built, widgetDir, { recursive: true });
console.log(`Widget copied to ${widgetDir}`);

const outputDir = join(extension, '.output');
const zips = existsSync(outputDir)
  ? readdirSync(outputDir)
      .filter((name) => name.endsWith('-chrome.zip'))
      .map((name) => join(outputDir, name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  : [];
if (zips[0]) {
  mkdirSync(downloads, { recursive: true });
  cpSync(zips[0], join(downloads, 'iris-extension.zip'));
  console.log(`Extension zip copied from ${zips[0]}`);
} else {
  console.log('No extension zip yet (pnpm --filter extension zip); the download link will 404.');
}
