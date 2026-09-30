import type { RiskCategory, Severity } from '../../core/api';
import { CATEGORY_LABELS } from '../labels';

const SEVERITY_WORDS: Record<Severity, string> = {
  high: 'High:',
  medium: 'Medium:',
  info: 'Info:',
};

interface RiskTagProps {
  severity: Severity;
  category?: RiskCategory;
  /** Overrides the category label (the page strip's counted wording). */
  label?: string;
}

/** A severity dot with plain words, never colour alone. */
export function RiskTag({ severity, category, label }: RiskTagProps) {
  const text = label ?? (category ? CATEGORY_LABELS[category] : '');
  return (
    <span class="iris-risk-tag">
      <span class={`iris-dot iris-dot--${severity}`} aria-hidden="true" />
      <span class="iris-visually-hidden">{SEVERITY_WORDS[severity]} </span>
      {text}
    </span>
  );
}

interface RiskTagListProps {
  risks: { id: string; severity: Severity; category: RiskCategory }[];
  /** How many to show before "and N more". */
  limit?: number;
}

export function RiskTagList({ risks, limit = 3 }: RiskTagListProps) {
  if (risks.length === 0) return null;
  const shown = risks.slice(0, limit);
  const more = risks.length - shown.length;
  return (
    <p class="iris-risk-tags">
      {shown.map((risk) => (
        <RiskTag key={risk.id} severity={risk.severity} category={risk.category} />
      ))}
      {more > 0 && <span class="iris-risk-tags__more">and {more} more</span>}
    </p>
  );
}
