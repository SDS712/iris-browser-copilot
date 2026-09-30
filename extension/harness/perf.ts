/**
 * Reader performance check: builds a page of 5,000 elements and
 * times snapshots. The e2e test calls window.irisPerf().
 */
import { browserLayout } from '../src/page/layout';
import { pageTypeHint } from '../src/page/page-type';
import { Reader } from '../src/page/reader';
import { Registry } from '../src/page/registry';
import { clientFlags } from '../src/page/rules';

function buildPage(root: HTMLElement): number {
  const parts: string[] = [];
  let count = 0;
  for (let s = 0; s < 250; s += 1) {
    parts.push(`<section><h2>${String(s + 1)} Section heading</h2>`);
    count += 2;
    for (let p = 0; p < 3; p += 1) {
      parts.push(
        `<p>Paragraph ${String(p)} of section ${String(s)} with <a href="#x${String(p)}">a link</a> and <em>some</em> words.</p>`,
      );
      count += 3;
    }
    parts.push(
      `<div class="row"><label for="f${String(s)}">Field ${String(s)}</label><input id="f${String(s)}"></div>`,
    );
    parts.push(`<div><span>Item ${String(s)}</span> <span>₹${String(1000 + s)}</span></div>`);
    parts.push(`<ul><li>One</li><li>Two</li><li>Three</li></ul>`);
    count += 3 + 3 + 4;
  }
  root.innerHTML = parts.join('');
  return count;
}

declare global {
  interface Window {
    irisPerf?: () => { elements: number; timings: number[] };
  }
}

window.irisPerf = () => {
  const root = document.getElementById('page');
  if (!root) throw new Error('no root');
  const elements = buildPage(root);
  const timings: number[] = [];
  for (let run = 0; run < 5; run += 1) {
    const reader = new Reader(new Registry(), browserLayout);
    const start = performance.now();
    const read = reader.read(1);
    read.snapshot.page_type_hint = pageTypeHint(read.snapshot);
    read.snapshot.client_flags = clientFlags({
      snapshot: read.snapshot,
      prices: read.prices,
      countdownIds: [],
    });
    timings.push(performance.now() - start);
  }
  return { elements: document.querySelectorAll('#page *').length || elements, timings };
};
