/**
 * Watches the page for meaningful changes: a MutationObserver on <body>,
 * debounced by 800 ms, plus single-page-app navigation. It only listens; nothing on the
 * page is wrapped or changed. Navigation is seen through the Navigation API where it
 * exists, popstate, and a URL check after every batch of changes.
 */
import { IRIS_HOSTS } from './labels';

export interface WatcherOptions {
  doc?: Document;
  debounceMs?: number;
  /** Something changed; the owner decides whether it matters. */
  onChange: () => void;
  /** The URL (without the #fragment) changed without a reload. */
  onNavigate: () => void;
}

const WATCHED_ATTRIBUTES = ['hidden', 'style', 'class', 'open'];

export function urlWithoutHash(url: string): string {
  return url.split('#')[0] ?? url;
}

function insideIris(node: Node): boolean {
  for (
    let el: Element | null = node instanceof Element ? node : node.parentElement;
    el;
    el = el.parentElement
  ) {
    if (IRIS_HOSTS.has(el.tagName.toUpperCase())) return true;
  }
  return false;
}

/** A countdown ticking over ("09:59" → "09:58") isn't worth a re-read on its own. */
function isTick(record: MutationRecord): boolean {
  return record.type === 'characterData' && (record.target.textContent ?? '').trim().length <= 20;
}

export class Watcher {
  private readonly doc: Document;
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private url: string;
  private navigationTarget: EventTarget | null = null;

  constructor(private readonly options: WatcherOptions) {
    this.doc = options.doc ?? document;
    this.url = urlWithoutHash(this.doc.location.href);
  }

  start(): void {
    const win = this.doc.defaultView;
    this.observer = new MutationObserver((records) => {
      this.checkUrl();
      if (records.every((record) => insideIris(record.target) || isTick(record))) return;
      this.schedule();
    });
    this.observer.observe(this.doc.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: WATCHED_ATTRIBUTES,
    });
    win?.addEventListener('popstate', this.checkUrl);
    this.navigationTarget =
      (win as unknown as { navigation?: EventTarget } | null)?.navigation ?? null;
    this.navigationTarget?.addEventListener('currententrychange', this.checkUrl);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    clearTimeout(this.timer);
    this.doc.defaultView?.removeEventListener('popstate', this.checkUrl);
    this.navigationTarget?.removeEventListener('currententrychange', this.checkUrl);
    this.navigationTarget = null;
  }

  /** Runs a pending debounced check now (before a snapshot is taken on request). */
  flush(): boolean {
    if (this.timer === undefined) return false;
    clearTimeout(this.timer);
    this.timer = undefined;
    return true;
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.options.onChange();
    }, this.options.debounceMs ?? 800);
  }

  private readonly checkUrl = () => {
    const url = urlWithoutHash(this.doc.location.href);
    if (url === this.url) return;
    this.url = url;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.options.onNavigate();
  };
}
