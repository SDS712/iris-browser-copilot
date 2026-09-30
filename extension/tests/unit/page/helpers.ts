import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { browserLayout, displayedByStyle, type Layout } from '../../../src/page/layout';
import { Reader } from '../../../src/page/reader';
import { Registry } from '../../../src/page/registry';
import { clientFlags } from '../../../src/page/rules';
import { pageTypeHint } from '../../../src/page/page-type';

/** happy-dom has no layout: everything displayed gets a 100 × 20 box. */
export const testLayout: Layout = {
  displayed: displayedByStyle,
  rect: (el) =>
    displayedByStyle(el)
      ? { x: 0, y: 0, width: 100, height: 20 }
      : { x: 0, y: 0, width: 0, height: 0 },
  style: (el) => browserLayout.style(el),
};

export function loadHtml(html: string): void {
  const head = /<head>([\s\S]*)<\/head>/i.exec(html)?.[1] ?? '';
  const body = /<body>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  document.head.innerHTML = head.replace(/<script[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  document.title = /<title>([^<]*)<\/title>/i.exec(head)?.[1] ?? '';
}

export function loadFixture(name: string): void {
  loadHtml(readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', name), 'utf8'));
}

export function newReader() {
  const registry = new Registry();
  const reader = new Reader(registry, testLayout);
  return { registry, reader };
}

/** A full snapshot with flags, as the runtime builds it (countdowns passed in). */
export function snapshotOf(reader: Reader, revision = 1, countdownIds: string[] = []) {
  const read = reader.read(revision);
  read.snapshot.page_type_hint = pageTypeHint(read.snapshot);
  read.snapshot.client_flags = clientFlags({
    snapshot: read.snapshot,
    prices: read.prices,
    countdownIds,
  });
  return read;
}
