/**
 * Element IDs: "i-<n>" for fields, choices, buttons, prices,
 * links and the cookie banner, "s-<n>" for sections. IDs live only in memory: nothing is
 * ever added to the page's elements, and an element keeps its ID for the whole document.
 */
export type IdKind = 'i' | 's';

export class Registry {
  /** Separate maps per kind: a paragraph can be a price (i-) and a section anchor (s-). */
  private ids = { i: new WeakMap<Element, string>(), s: new WeakMap<Element, string>() };
  private refs = new Map<string, WeakRef<Element>>();
  /** Continuation parts of long sections ("s-4" part 2 → "s-9"). */
  private parts = new Map<string, string>();
  private next = { i: 1, s: 1 };

  idFor(el: Element, kind: IdKind): string {
    const existing = this.ids[kind].get(el);
    if (existing) return existing;
    const id = this.allocate(kind);
    this.ids[kind].set(el, id);
    this.refs.set(id, new WeakRef(el));
    return id;
  }

  /** A stable ID for part `part` (2, 3, …) of a section that was split. */
  partId(sectionId: string, part: number, anchor: Element): string {
    const key = `${sectionId}#${String(part)}`;
    let id = this.parts.get(key);
    if (!id) {
      id = this.allocate('s');
      this.parts.set(key, id);
      this.refs.set(id, new WeakRef(anchor));
    }
    return id;
  }

  peek(el: Element, kind: IdKind = 'i'): string | undefined {
    return this.ids[kind].get(el);
  }

  /** The element, or null if it has gone from the page. */
  elementFor(id: string): Element | null {
    const el = this.refs.get(id)?.deref();
    if (!el?.isConnected) return null;
    return el;
  }

  /** Single-page-app navigation: fresh IDs from 1. */
  reset(): void {
    this.ids = { i: new WeakMap(), s: new WeakMap() };
    this.refs.clear();
    this.parts.clear();
    this.next = { i: 1, s: 1 };
  }

  private allocate(kind: IdKind): string {
    const id = `${kind}-${String(this.next[kind])}`;
    this.next[kind] += 1;
    return id;
  }
}
