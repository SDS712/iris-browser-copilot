/**
 * Hesitation on a form field: 9 seconds in an empty field with no typing, or the
 * field cleared twice within 60 seconds. Listening only; values are never read, only
 * whether a field is empty.
 */
import { IRIS_HOSTS } from './labels';
import { isFilled, type FormControl } from './privacy';

export const LINGER_MS = 9_000;
export const CLEARED_WINDOW_MS = 60_000;

export interface HesitationOptions {
  doc?: Document;
  /** The field's element ID if it's a field Iris has read, else null. */
  fieldId: (el: Element) => string | null;
  onHesitation: (elementId: string) => void;
  /** The user typed in, or left, a field (chips on it go away). */
  onFieldActivity?: (el: Element) => void;
  now?: () => number;
}

function isControl(el: EventTarget | null): el is FormControl {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  );
}

export class HesitationDetector {
  private readonly doc: Document;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private wasFilled = new WeakMap<Element, boolean>();
  private clears = new WeakMap<Element, number[]>();

  constructor(private readonly options: HesitationOptions) {
    this.doc = options.doc ?? document;
  }

  start(): void {
    this.doc.addEventListener('focusin', this.onFocus, true);
    this.doc.addEventListener('focusout', this.onBlur, true);
    this.doc.addEventListener('input', this.onInput, true);
    this.doc.addEventListener('keydown', this.onKey, true);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.doc.removeEventListener('focusin', this.onFocus, true);
    this.doc.removeEventListener('focusout', this.onBlur, true);
    this.doc.removeEventListener('input', this.onInput, true);
    this.doc.removeEventListener('keydown', this.onKey, true);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private arm(el: FormControl): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const id = this.options.fieldId(el);
      if (id && this.doc.activeElement === el && !isFilled(el)) this.options.onHesitation(id);
    }, LINGER_MS);
  }

  private readonly onFocus = (event: Event) => {
    const el = event.target;
    if (!isControl(el) || !this.options.fieldId(el)) return;
    this.wasFilled.set(el, isFilled(el));
    this.arm(el);
  };

  private readonly onBlur = (event: Event) => {
    clearTimeout(this.timer);
    this.timer = undefined;
    // Focus moving onto Iris's own chip isn't leaving the field.
    const next = (event as FocusEvent).relatedTarget;
    if (next instanceof Element && IRIS_HOSTS.has(next.tagName.toUpperCase())) return;
    if (event.target instanceof Element) this.options.onFieldActivity?.(event.target);
  };

  private readonly onKey = (event: Event) => {
    const el = event.target;
    if (!isControl(el) || !this.options.fieldId(el)) return;
    this.arm(el);
  };

  private readonly onInput = (event: Event) => {
    const el = event.target;
    if (!isControl(el)) return;
    this.options.onFieldActivity?.(el);
    const id = this.options.fieldId(el);
    if (!id) return;
    this.arm(el);
    const filled = isFilled(el);
    if (this.wasFilled.get(el) === true && !filled) {
      const now = this.now();
      const recent = [...(this.clears.get(el) ?? []), now].filter(
        (t) => now - t <= CLEARED_WINDOW_MS,
      );
      if (recent.length >= 2) {
        this.clears.set(el, []);
        this.options.onHesitation(id);
      } else this.clears.set(el, recent);
    }
    this.wasFilled.set(el, filled);
  };
}
