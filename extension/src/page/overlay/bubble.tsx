/** The note bubble beside a highlighted item. */
import type { RiskCategory, Severity } from '../../core/api';
import { CATEGORY_LABELS } from '../../ui/labels';

export interface BubbleContent {
  title?: string | null;
  text?: string | null;
  risk?: { severity: Severity; category: RiskCategory } | null;
}

/** The 12 px Iris glyph (the dot-less small variant). */
export function Glyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 128 128" aria-hidden="true">
      <circle cx="64" cy="64" r="62" fill="#0F766E" />
      <circle cx="64" cy="64" r="26" fill="none" stroke="#0B4A46" stroke-width="14" />
      <circle cx="64" cy="64" r="12" fill="#0B4A46" />
    </svg>
  );
}

export function Bubble({ content, onDismiss }: { content: BubbleContent; onDismiss: () => void }) {
  const { title, text, risk } = content;
  return (
    <div role="note" aria-label="Iris">
      <div class="bubble-head">
        <Glyph />
        {title ? <span class="bubble-title">{title}</span> : <span class="sr-only">Iris</span>}
      </div>
      {text && <p>{text}</p>}
      {risk && (
        <span class="tag">
          <span class={`dot ${risk.severity}`} aria-hidden="true" />
          {CATEGORY_LABELS[risk.category]}
        </span>
      )}
      <div>
        <button type="button" class="got-it" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}
