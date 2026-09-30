import { VERDICT_LABELS } from '../labels';

export type Verdict = keyof typeof VERDICT_LABELS;

/** Filled verdict pill. Never "Safe". */
export function VerdictChip({ verdict }: { verdict: Verdict }) {
  return <span class={`iris-verdict iris-verdict--${verdict}`}>{VERDICT_LABELS[verdict]}</span>;
}
